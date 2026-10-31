/**
 * Browser checks for two file-header affordances:
 *
 *   1. The full path tooltip — the row truncates a long path, so hovering must
 *      show the whole path in a readable box.
 *   2. The "more actions" menu — "Expand all" lives in a three-dots menu and is
 *      offered ONLY when the file still hides something.
 *
 * Runs against the PR fixture, so it needs no repository, gh or network.
 *
 * Run: node tests/file-header-ui.mjs
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { startReview } from "../src/core.js";
import { MODE, GH } from "../src/config.js";
const ROOT = dirname(fileURLToPath(import.meta.url));
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "pr-review-ghdb-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
}));
process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;
