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
const PAUSE = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Target name a new browser tab is opened with. */
const TARGET_BLANK = "_blank";
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 }))
  .build();
const failures = [];
function check(name, fn) {
  return fn().then(
    () => console.log(`PASS ${name}`),
    (error) => {
      failures.push(`${name}: ${error.message}`);
      console.log(`FAIL ${name} — ${error.message}`);
    },
  );
}
