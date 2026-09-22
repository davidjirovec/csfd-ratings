import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(
  ROOT,
  "node_modules",
  "node-csfd-api",
  "anubis",
  "challenge.js",
);

const original = await readFile(target, "utf8");
const exactMatch = 'pair.startsWith(`${name}=`)';
const prefixMatch =
  '(pair.startsWith(`${name}=`) || pair.startsWith(`${name}-`))';

if (original.includes(prefixMatch)) {
  console.log("node-csfd-api already accepts suffixed Anubis cookie names.");
} else if (original.includes(exactMatch)) {
  await writeFile(target, original.replaceAll(exactMatch, prefixMatch), "utf8");
  console.log("Patched node-csfd-api to accept suffixed Anubis cookie names.");
} else {
  throw new Error(
    "Could not locate node-csfd-api Anubis cookie-name matcher; upstream layout changed.",
  );
}
