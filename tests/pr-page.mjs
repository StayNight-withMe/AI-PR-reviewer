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
