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
test("no duplicated route paths", () => {
  const routes = Object.values(CONFIG.ROUTES);
  assert.equal(new Set(routes).size, routes.length);
});
test("client constants mirror server constants", async () => {
  const text = await readFile(join(SRC, "assets", "constants.js"), "utf8");

  for (const route of Object.values(CONFIG.ROUTES).filter((value) => value.startsWith("/api/"))) {
    assert.ok(text.includes(route), `client constants missing ${route}`);
  }
});
test("every PR helper is invoked through its namespace", async () => {
  const files = await collectFiles(join(SRC, "assets"));
  const offenders = [];

  for (const file of files) {
    const name = file.split(/[\\/]/).pop();
    if (name === "constants.js" || name === "hljs-bundle.js") continue;

    const text = await readFile(file, "utf8");
    const exported = new Set();
    for (const match of text.matchAll(/PR\.([A-Za-z_]\w*)\s*=\s*function/g)) exported.add(match[1]);

    for (const fn of exported) {
      // A bare call (not part of an object property and not prefixed by PR.)
      const bareCall = new RegExp(`(^|[^.\\w])${fn}\\s*\\(`, "m");
      if (bareCall.test(text)) offenders.push(`PR.${fn} called bare in ${name}`);
    }
  }

  assert.deepEqual(offenders, [], `must use the PR namespace:\n${offenders.join("\n")}`);
});

test("every client constant referenced by UI code exists", async () => {
  const files = await collectFiles(join(SRC, "assets"));
  const constantsText = await readFile(join(SRC, "assets", "constants.js"), "utf8");

  // Parse `window.PR.NAME = { KEY: ..., KEY2: ... }` blocks into a namespace -> keys map.
  const namespaces = {};
  const blockRe = /window\.PR\.([A-Za-z_]\w*)\s*=\s*\{([\s\S]*?)\n  \};/g;
  for (const block of constantsText.matchAll(blockRe)) {
    const keys = new Set();
    for (const key of block[2].matchAll(/^\s{4}([A-Za-z_]\w*):/gm)) keys.add(key[1]);
    namespaces[block[1]] = keys;
  }

  const usage = new RegExp(`\\bPR\\.(${Object.keys(namespaces).join("|")})\\.([A-Za-z_][A-Za-z0-9_]*)`, "g");
  const missing = [];

  for (const file of files) {
    if (file.endsWith(join("assets", "constants.js"))) continue;
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(usage)) {
      const [, namespace, key] = match;
      if (!namespaces[namespace].has(key)) missing.push(`PR.${namespace}.${key} in ${file}`);
    }
  }

  assert.deepEqual(missing, [], `missing client constants:\n${missing.join("\n")}`);
});
