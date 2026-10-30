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
