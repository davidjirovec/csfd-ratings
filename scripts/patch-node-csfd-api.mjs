import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  ROOT,
  "node_modules",
  "node-csfd-api",
  "anubis",
  "proof-of-work.js",
);

const original = await readFile(target, "utf8");
const from = "const DEFAULT_TIME_BUDGET_MS = 1e4;";
const fallbackFrom = "const DEFAULT_TIME_BUDGET_MS = 10_000;";
const to = "const DEFAULT_TIME_BUDGET_MS = 60_000;";

let patched;
if (original.includes(from)) {
  patched = original.replace(from, to);
} else if (original.includes(fallbackFrom)) {
  patched = original.replace(fallbackFrom, to);
} else if (original.includes(to)) {
  console.log("node-csfd-api Anubis time budget is already patched to 60s.");
  process.exit(0);
} else {
  throw new Error(
    "Could not locate node-csfd-api Anubis DEFAULT_TIME_BUDGET_MS; upstream layout changed.",
  );
}

await writeFile(target, patched, "utf8");
console.log("Patched node-csfd-api Anubis proof-of-work time budget from 10s to 60s.");
