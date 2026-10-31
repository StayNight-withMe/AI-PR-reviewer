/**
 * Resolving review comments, from the page and from the agent.
 *
 * A review comment can be marked resolved when it is fixed: on the page with
 * the "Resolve" button, and by the agent through the `resolve_comments` MCP tool,
 * which writes the same `review.json`/`review.md` the page shows.
 *
 * Also checks that a re-review after a code change is a NEW review: the old
 * "Viewed" flags must not carry over, which was a stale-state bug.
 *
 * Run: node tests/resolve.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { buildReview, startReview } from "../src/core.js";
import { MODE } from "../src/config.js";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { GH } from "../src/config.js";
import { buildMarkdown } from "../src/render.js";
const ROOT = dirname(fileURLToPath(import.meta.url));
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
