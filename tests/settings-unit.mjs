/**
 * The device-wide settings file, without a browser.
 *
 * Settings are deliberately NOT in localStorage: a review page is served from
 * an ephemeral port, and localStorage is scoped to the origin, port included.
 * They live in one small file per user instead.
 *
 * Run: node --test tests/settings-unit.mjs
 */
import assert from "node:assert/strict";
