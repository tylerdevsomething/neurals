// Fails if any file in the repo names another project. The names are stored encoded so this file
// does not trip its own check. Whole words only: "inscribe", "inscription" and "sequential" pass.
// Run: node tools/names-check.ts   (before every commit)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const decode = (s: string) => Buffer.from(s, "base64").toString("utf8");
const BANNED = ["c2VxdWVudA==", "c2NyaWJl", "cmFyaXR5", "cHJvb2YtdmF1bHQ="].map(decode);
const DOLLAR_TICKER = decode("JHByb29m"); // the other project's ticker, with its "$"

const pattern = new RegExp(
  `\\b(?:${BANNED.map((w) => w.replace(/[-]/g, "\\-") + "s?").join("|")})\\b|\\${DOLLAR_TICKER}\\b`,
  "i",
);

const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", ".anchor", "test-ledger"]);
// The front end handed over as is (2026-11-10): kept byte for byte at the owner's request, so not checked.
const SKIP_PATHS = new Set(["site-v2", "hero-lab"]);
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|gguf|bin|so|wasm|pdf|lock)$/i;

const root = join(import.meta.dirname, "..");
const hits: string[] = [];

function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (pattern.test(name)) hits.push(`${rel}: file name`);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name) && !SKIP_PATHS.has(rel) && !name.startsWith("neurals-frontend-")) walk(path);
      continue;
    }
    if (SKIP_EXT.test(name)) continue;
    readFileSync(path, "utf8").split("\n").forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
}

walk(root);
if (hits.length) {
  console.error(`names check failed (${hits.length}):\n` + hits.join("\n"));
  process.exit(1);
}
console.log("names check: clean");
