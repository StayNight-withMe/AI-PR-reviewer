/**
 * Regression suite for the reported review-UI bugs:
 * viewed/collapse, gutter drag selection, expand-all, eager highlighting,
 * symbol links, Last file, viewer hash navigation and viewer comments.
 */
import assert from "node:assert/strict";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
const BASE = process.argv[2] ?? "http://127.0.0.1:5454/";
const SCRIPT_TIMEOUT = 30_000;
