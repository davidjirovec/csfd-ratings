import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_ROOT = path.join(ROOT, "node_modules", "node-csfd-api");

const patchProofOfWorkBudget = async () => {
  const target = path.join(PACKAGE_ROOT, "anubis", "proof-of-work.js");
  const original = await readFile(target, "utf8");
  const candidates = [
    "const DEFAULT_TIME_BUDGET_MS = 1e4;",
    "const DEFAULT_TIME_BUDGET_MS = 10_000;",
  ];
  const replacement = "const DEFAULT_TIME_BUDGET_MS = 60_000;";

  if (original.includes(replacement)) {
    console.log("node-csfd-api Anubis time budget is already patched to 60s.");
    return;
  }

  const source = candidates.find((candidate) => original.includes(candidate));
  if (!source) {
    throw new Error(
      "Could not locate node-csfd-api Anubis DEFAULT_TIME_BUDGET_MS; upstream layout changed.",
    );
  }

  await writeFile(target, original.replace(source, replacement), "utf8");
  console.log("Patched node-csfd-api Anubis proof-of-work time budget from 10s to 60s.");
};

const patchChallengeFingerprint = async () => {
  const target = path.join(PACKAGE_ROOT, "fetchers", "index.js");
  const original = await readFile(target, "utf8");

  if (original.includes("anubis.pass(html, response.headers, url, buildHeaders(optionsRequest))")) {
    console.log("node-csfd-api Anubis challenge already reuses the original request fingerprint.");
    return;
  }

  const pattern =
    /anubis\.pass\(\s*html,\s*response\.headers,\s*url,\s*new Headers\(\{\s*\.\.\.baseHeaders,\s*\.\.\.randomProfile\(\)\s*\}\)\s*\)/m;

  if (!pattern.test(original)) {
    throw new Error(
      "Could not locate node-csfd-api Anubis challenge header construction; upstream layout changed.",
    );
  }

  const patched = original.replace(
    pattern,
    "anubis.pass(html, response.headers, url, buildHeaders(optionsRequest))",
  );
  await writeFile(target, patched, "utf8");
  console.log("Patched node-csfd-api Anubis challenge to reuse the original request fingerprint.");
};

await patchProofOfWorkBudget();
await patchChallengeFingerprint();
