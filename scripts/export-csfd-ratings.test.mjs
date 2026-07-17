import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeCsfdUrl,
  createSnapshot,
  fetchAllRatingPages,
  normalizeTitle,
  validateRatingPage,
} from "./export-csfd-ratings.mjs";

const rating = (id) => ({
  title: `Film ${id}`,
  url: `https://www.csfd.cz/film/${id}-film-${id}/`,
});

test("normalizes Czech titles for matching", () => {
  assert.equal(normalizeTitle("  Na samotě u lesa!  "), "na samote u lesa");
});

test("canonicalizes ČSFD film URLs", () => {
  assert.equal(
    canonicalizeCsfdUrl("https://www.csfd.cz/film/123-film/prehled/?from=search"),
    "https://www.csfd.cz/film/123-film/",
  );
});

test("deduplicates and sorts ratings by canonical URL", () => {
  const snapshot = createSnapshot([
    { title: "Želary", url: "https://www.csfd.cz/film/9061-zelary/", year: 2003 },
    { title: "Amélie", url: "https://www.csfd.cz/film/29221-amelie/prehled/", year: 2001 },
    { title: "Amélie", url: "https://www.csfd.cz/film/29221-amelie/", year: 2001 },
  ], "2026-07-14T12:00:00.000Z");

  assert.equal(snapshot.count, 2);
  assert.deepEqual(snapshot.ratings.map(({ title }) => title), ["Amélie", "Želary"]);
});

test("rejects a short page before the expected final page", () => {
  assert.throws(
    () => validateRatingPage({
      ratings: [rating(1)],
      page: 1,
      minimumPageCount: 2,
      minimumFinalPageSize: 1,
      pageSize: 2,
      seenUrls: new Set(),
    }),
    /Page 1 contains only 1 ratings; expected at least 2/u,
  );
});

test("retries only the incomplete page", async () => {
  const calls = [];
  const waits = [];
  const pageOneResponses = [[], [rating(1), rating(2)]];
  const ratings = await fetchAllRatingPages({
    fetchPage: async (page) => {
      calls.push(page);
      return page === 1 ? pageOneResponses.shift() : [rating(3)];
    },
    minimumExpectedCount: 3,
    pageSize: 2,
    pageDelayMs: 4,
    pageDelayJitterMs: 0,
    retryDelays: [0, 1],
    waitFor: async (milliseconds) => waits.push(milliseconds),
    random: () => 0,
    log: () => {},
    logError: () => {},
  });

  assert.deepEqual(calls, [1, 1, 2]);
  assert.deepEqual(waits, [1, 4]);
  assert.deepEqual(ratings.map(({ title }) => title), ["Film 1", "Film 2", "Film 3"]);
});

test("retries a page that repeats previously fetched ratings", async () => {
  const calls = [];
  const pageTwoResponses = [[rating(1), rating(2)], [rating(3)]];
  const ratings = await fetchAllRatingPages({
    fetchPage: async (page) => {
      calls.push(page);
      return page === 1 ? [rating(1), rating(2)] : pageTwoResponses.shift();
    },
    minimumExpectedCount: 3,
    pageSize: 2,
    pageDelayMs: 0,
    pageDelayJitterMs: 0,
    retryDelays: [0, 1],
    waitFor: async () => {},
    random: () => 0,
    log: () => {},
    logError: () => {},
  });

  assert.deepEqual(calls, [1, 2, 2]);
  assert.deepEqual(ratings.map(({ title }) => title), ["Film 1", "Film 2", "Film 3"]);
});
