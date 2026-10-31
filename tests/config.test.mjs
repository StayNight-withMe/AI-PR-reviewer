/**
 * Guards against the class of bug where a module references a constant that was
 * renamed or dropped from the config: every `SYMBOL_INDEX.X`, `GIT.X`, `P.X`
 * etc. used anywhere in src/ must actually exist.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as CONFIG from "../src/config.js";
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const NAMESPACES = ["P", "SERVER", "ROUTES", "QUERY", "GIT", "ARTIFACTS", "TOOLS", "SYMBOL_INDEX", "SYMBOL_KIND", "DIFF", "RENDER", "UI", "MODE", "MODE_LABELS", "REVIEW_STATE", "REVIEW_STATE_LABEL", "REVIEW_STATE_DOT", "DIFF_MODE", "TREE_OPEN", "SYMBOL_LINKS", "THEME", "DISPATCH_MODE", "TREE", "FILEVIEW", "ASSETS", "FILES"];
const USAGE = new RegExp(`\\b(${NAMESPACES.join("|")})\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full)));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}
test("every config constant referenced by source code exists", async () => {
  const files = await collectFiles(SRC);
  const missing = [];

  for (const file of files) {
    if (file.endsWith(join("assets", "constants.js"))) continue;
    const text = await readFile(file, "utf8");

    for (const match of text.matchAll(USAGE)) {
      const [, namespace, key] = match;
      const bag = CONFIG[namespace];
      if (!bag) { missing.push(`${namespace} (namespace) in ${file}`); continue; }
      if (!(key in bag)) missing.push(`${namespace}.${key} in ${file}`);
    }
  }

  assert.deepEqual(missing, [], `missing constants:\n${missing.join("\n")}`);
});
