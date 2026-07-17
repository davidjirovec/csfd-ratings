import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { csfd } from "node-csfd-api";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USERNAME = process.env.CSFD_USER ?? "115923-bon-go";
const OUTPUT_PATH = path.resolve(ROOT, process.env.OUTPUT_PATH ?? "data/csfd-ratings.json");
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? "5000");
const PAGE_DELAY_JITTER_MS = Number(process.env.PAGE_DELAY_JITTER_MS ?? "1500");
const MIN_EXPECTED_RATINGS = Number(process.env.MIN_EXPECTED_RATINGS ?? "1300");
const MAX_DROP_RATIO = Number(process.env.MAX_DROP_RATIO ?? "0.01");
const ALLOW_RATING_DROP = process.env.ALLOW_RATING_DROP === "true";
const RATINGS_PER_PAGE = 50;
const PAGE_RETRY_DELAYS_MS = [0, 15_000, 60_000, 180_000];
const REQUEST_OPTIONS = {
  request: {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      "Sec-Ch-Ua": "\"Google Chrome\";v=\"151\", \"Chromium\";v=\"151\", "
        + "\"Not_A Brand\";v=\"24\"",
      "Sec-Ch-Ua-Platform": "\"Windows\"",
    },
  },
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export const normalizeTitle = (title) => String(title ?? "")
  .normalize("NFKD")
  .replace(/\p{Mark}/gu, "")
  .toLocaleLowerCase("cs-CZ")
  .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
  .trim()
  .replace(/\s+/g, " ");

export const canonicalizeCsfdUrl = (value) => {
  const url = new URL(value);
  const filmPath = url.pathname.match(/^\/film\/\d+(?:-[^/]+)?/u)?.[0];
  if (!filmPath) {
    throw new Error(`Unexpected ČSFD film URL: ${value}`);
  }
  return `https://www.csfd.cz${filmPath}/`;
};

const csfdIdFromUrl = (url) => Number(url.match(/\/film\/(\d+)/u)?.[1]);

const normalizeRating = (rating) => {
  if (!rating?.title || !rating?.url) {
    throw new Error(`Rating is missing a title or URL: ${JSON.stringify(rating)}`);
  }

  const url = canonicalizeCsfdUrl(rating.url);
  return {
    csfdId: csfdIdFromUrl(url),
    title: rating.title.trim(),
    normalizedTitle: normalizeTitle(rating.title),
    year: rating.year ?? null,
    type: rating.type ?? null,
    url,
    userRating: rating.userRating ?? null,
    userDate: rating.userDate ?? null,
  };
};

export const createSnapshot = (ratings, generatedAt = new Date().toISOString()) => {
  const normalized = ratings.map(normalizeRating);
  const unique = [...new Map(normalized.map((rating) => [rating.url, rating])).values()]
    .sort((left, right) => left.normalizedTitle.localeCompare(right.normalizedTitle, "cs"));

  return {
    schemaVersion: 1,
    generatedAt,
    source: `https://www.csfd.cz/uzivatel/${USERNAME}/hodnoceni/`,
    user: USERNAME,
    count: unique.length,
    ratings: unique,
  };
};

const readPreviousSnapshot = async () => {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const validateSnapshot = (snapshot, previousSnapshot = null) => {
  if (snapshot.count < MIN_EXPECTED_RATINGS) {
    throw new Error(
      `Export contains only ${snapshot.count} ratings; expected at least ${MIN_EXPECTED_RATINGS}.`,
    );
  }

  const previousCount = previousSnapshot?.count ?? previousSnapshot?.ratings?.length ?? 0;
  const minimumRelativeCount = Math.floor(previousCount * (1 - MAX_DROP_RATIO));
  if (!ALLOW_RATING_DROP && previousCount > 0 && snapshot.count < minimumRelativeCount) {
    throw new Error(
      `Export dropped from ${previousCount} to ${snapshot.count} ratings. `
      + "Set ALLOW_RATING_DROP=true only when the decrease is intentional.",
    );
  }
};

export const minimumExpectedRatingCount = (previousSnapshot = null) => {
  const previousCount = previousSnapshot?.count ?? previousSnapshot?.ratings?.length ?? 0;
  if (ALLOW_RATING_DROP || previousCount === 0) {
    return MIN_EXPECTED_RATINGS;
  }
  return Math.max(MIN_EXPECTED_RATINGS, Math.floor(previousCount * (1 - MAX_DROP_RATIO)));
};

const ratingsAreUnchanged = (snapshot, previousSnapshot) => previousSnapshot
  && JSON.stringify(snapshot.ratings) === JSON.stringify(previousSnapshot.ratings);

const canonicalUrls = (ratings) => ratings.map(({ url }) => canonicalizeCsfdUrl(url));

export const validateRatingPage = ({
  ratings,
  page,
  minimumPageCount,
  minimumFinalPageSize,
  pageSize,
  seenUrls,
}) => {
  if (!Array.isArray(ratings)) {
    throw new Error(`Page ${page} returned a non-array result.`);
  }

  const minimumPageSize = page < minimumPageCount
    ? pageSize
    : page === minimumPageCount
      ? minimumFinalPageSize
      : 0;
  if (ratings.length < minimumPageSize) {
    throw new Error(
      `Page ${page} contains only ${ratings.length} ratings; expected at least ${minimumPageSize}.`,
    );
  }

  const urls = canonicalUrls(ratings);
  const newUrls = urls.filter((url) => !seenUrls.has(url));
  if (ratings.length > 0 && newUrls.length === 0) {
    throw new Error(`Page ${page} repeats only ratings already fetched.`);
  }

  return newUrls;
};

const fetchRatingPage = async ({
  page,
  fetchPage,
  minimumPageCount,
  minimumFinalPageSize,
  pageSize,
  retryDelays,
  seenUrls,
  waitFor,
  log,
  logError,
}, attempt = 0) => {
  const delay = retryDelays[attempt];
  if (delay > 0) {
    log(`Retrying ČSFD ratings page ${page} in ${delay / 1000} seconds...`);
    await waitFor(delay);
  }

  let terminalPageCandidate = false;
  try {
    const startedAt = Date.now();
    const ratings = await fetchPage(page);
    terminalPageCandidate = page > minimumPageCount && ratings.length === 0;
    if (terminalPageCandidate && attempt === retryDelays.length - 1) {
      log(`Confirmed end of ČSFD ratings at empty page ${page}.`);
      return { ratings, newUrls: [] };
    }

    const newUrls = validateRatingPage({
      ratings,
      page,
      minimumPageCount,
      minimumFinalPageSize,
      pageSize,
      seenUrls,
    });
    if (terminalPageCandidate) {
      throw new Error(`Page ${page} is empty; retrying to confirm the end of pagination.`);
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(2);
    log(
      `Fetched ČSFD ratings page ${page}: ${ratings.length} rows, `
      + `${newUrls.length} new (${seconds}s).`,
    );
    return { ratings, newUrls };
  } catch (error) {
    logError(
      `ČSFD ratings page ${page} attempt ${attempt + 1}/${retryDelays.length} failed: `
      + error.message,
    );
    if (attempt + 1 < retryDelays.length) {
      return fetchRatingPage({
        page,
        fetchPage,
        minimumPageCount,
        minimumFinalPageSize,
        pageSize,
        retryDelays,
        seenUrls,
        waitFor,
        log,
        logError,
      }, attempt + 1);
    }
    if (terminalPageCandidate) {
      log(`Confirmed end of ČSFD ratings at empty page ${page}.`);
      return { ratings: [], newUrls: [] };
    }
    throw error;
  }
};

export const fetchAllRatingPages = async ({
  fetchPage,
  minimumExpectedCount,
  pageSize = RATINGS_PER_PAGE,
  pageDelayMs = PAGE_DELAY_MS,
  pageDelayJitterMs = PAGE_DELAY_JITTER_MS,
  retryDelays = PAGE_RETRY_DELAYS_MS,
  waitFor = wait,
  random = Math.random,
  log = console.log,
  logError = console.error,
}) => {
  const minimumPageCount = Math.ceil(minimumExpectedCount / pageSize);
  const minimumFinalPageSize = minimumExpectedCount - ((minimumPageCount - 1) * pageSize);

  const collectPage = async (page, pages, seenUrls) => {
    const result = await fetchRatingPage({
      page,
      fetchPage,
      minimumPageCount,
      minimumFinalPageSize,
      pageSize,
      retryDelays,
      seenUrls,
      waitFor,
      log,
      logError,
    });
    if (result.ratings.length === 0) {
      return pages.flat();
    }

    const nextPages = [...pages, result.ratings];
    const reachedLastPage = page >= minimumPageCount && result.ratings.length < pageSize;
    if (reachedLastPage) {
      return nextPages.flat();
    }

    const jitter = Math.floor(random() * (pageDelayJitterMs + 1));
    await waitFor(pageDelayMs + jitter);
    return collectPage(
      page + 1,
      nextPages,
      new Set([...seenUrls, ...result.newUrls]),
    );
  };

  return collectPage(1, [], new Set());
};

const fetchSnapshot = async (previousSnapshot) => {
  const ratings = await fetchAllRatingPages({
    fetchPage: (page) => csfd.userRatings(USERNAME, { page }, REQUEST_OPTIONS),
    minimumExpectedCount: minimumExpectedRatingCount(previousSnapshot),
  });
  return createSnapshot(ratings);
};

const writeSnapshotAtomically = async (snapshot) => {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.new`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, OUTPUT_PATH);
};

export const main = async () => {
  const previousSnapshot = await readPreviousSnapshot();
  const snapshot = await fetchSnapshot(previousSnapshot);
  validateSnapshot(snapshot, previousSnapshot);

  if (ratingsAreUnchanged(snapshot, previousSnapshot)) {
    console.log(`No rating changes (${snapshot.count} ratings).`);
    return;
  }

  await writeSnapshotAtomically(snapshot);
  console.log(`Wrote ${snapshot.count} ratings to ${path.relative(ROOT, OUTPUT_PATH)}.`);
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
