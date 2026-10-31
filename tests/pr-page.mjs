/**
 * Opens a PR review page on the mock fixture and checks it renders in a browser.
 *
 * This is the UI half of `test:pr`: the node half checks the diff and the API,
 * this one checks that the page actually shows the PR — badge, files, title,
 * a comment editor and the diff rows — with no JavaScript errors.
 *
 * Run: node tests/pr-page.mjs
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
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
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
const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: true });
const driver = await new Builder()
