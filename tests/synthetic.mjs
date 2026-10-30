/**
 * Deep checks against a synthetic two-month history.
 *
 * The fixture repository carries the shapes a real repository contains:
 * renames, deletions, binary files, unicode paths, CRLF endings, a file
 * without a trailing newline, a very long line, a mode change, a merge
 * commit, an empty commit, a few hundred generated files and a file big
 * enough to make the folding policy matter.
 *
 * Run: node tests/synthetic.mjs
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { buildReview, startReview } from "../src/core.js";
import { MODE, ROUTES } from "../src/config.js";
import { splitLines } from "../src/fileview.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSyntheticRepo, FEATURE, MAIN } from "./fixtures/synthetic-repo.mjs";
