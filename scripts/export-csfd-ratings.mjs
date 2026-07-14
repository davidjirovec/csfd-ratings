import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { csfd } from "node-csfd-api";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const USERNAME = process.env.CSFD_USER ?? "115923-bon-go";
const OUTPUT_PATH = path.resolve(ROOT, process.env.OUTPUT_PATH ?? "data/csfd-ratings.json");
const ALL_PAGES_DELAY_MS = Number(process.env.ALL_PAGES_DELAY_MS ?? "2500");
const MIN_EXPECTED_RATINGS = Number(process.env.MIN_EXPECTED_RATINGS ?? "1300");
const MAX_DROP_RATIO = Number(process.env.MAX_DROP_RATIO ?? "0.01");
const ALLOW_RATING_DROP = process.env.ALLOW_RATING_DROP === "true";
const RETRY_DELAYS_MS = [0, 15_000, 60_000];

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

const ratingsAreUnchanged = (snapshot, previousSnapshot) => previousSnapshot
  && JSON.stringify(snapshot.ratings) === JSON.stringify(previousSnapshot.ratings);

const fetchSnapshot = async () => {
  const ratings = await csfd.userRatings(USERNAME, {
    allPages: true,
    allPagesDelay: ALL_PAGES_DELAY_MS,
    onProgress: (page, total) => console.log(`Fetched ČSFD ratings page ${page}/${total}`),
  });
  return createSnapshot(ratings);
};

const fetchWithRetries = async (previousSnapshot) => {
  let lastError;

  for (const [index, delay] of RETRY_DELAYS_MS.entries()) {
    if (delay > 0) {
      console.log(`Retrying in ${delay / 1000} seconds...`);
      await wait(delay);
    }

    try {
      const snapshot = await fetchSnapshot();
      validateSnapshot(snapshot, previousSnapshot);
      return snapshot;
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${index + 1}/${RETRY_DELAYS_MS.length} failed: ${error.message}`);
    }
  }

  throw lastError;
};

const writeSnapshotAtomically = async (snapshot) => {
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.new`;
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await rename(temporaryPath, OUTPUT_PATH);
};

export const main = async () => {
  const previousSnapshot = await readPreviousSnapshot();
  const snapshot = await fetchWithRetries(previousSnapshot);

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
