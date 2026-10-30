/**
 * End-to-end UI checks against the live review server (Firefox via geckodriver).
 * Verifies every requirement: viewed timing, collapse timing, multiline drag,
 * context expanders, symbol links, tree navigation, comments with images.
 *
 * Run: node tests/e2e.mjs [url]
 */
import { Builder, By, Key, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
const URL = process.argv[2] ?? "http://127.0.0.1:5454/";
