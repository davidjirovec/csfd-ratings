import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeCsfdUrl,
  createSnapshot,
  normalizeTitle,
} from "./export-csfd-ratings.mjs";

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
