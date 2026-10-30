/**
 * Settings must survive across reviews and page restarts.
 *
 * Settings are stored on the server under a device key, so they survive a new
 * review, a changed diff and a page restart.
 *
 * Run: node tests/settings-persistence.mjs
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startReview } from "../src/core.js";
import { MODE, GH } from "../src/config.js";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
const ROOT = dirname(fileURLToPath(import.meta.url));
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
