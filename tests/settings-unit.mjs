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
import { rm } from "node:fs/promises";
import { test } from "node:test";
import { readSettings, sanitizeSettings, settingsPath, writeSettings } from "../src/settings-store.js";
const clean = () => rm(settingsPath(), { force: true }).catch(() => {});
test("the settings file lives outside any repository", () => {
  const path = settingsPath();
  assert.ok(/ui-settings\.json$/.test(path), `unexpected path ${path}`);
  assert.ok(!path.includes(".pr-review"), "settings are still stored in the repo folder");
});
test("settings round-trip through the file", async () => {
  await clean();
  try {
    const written = await writeSettings({ theme: "light", treeIndent: 20, diffMode: "split" });
    assert.equal(written.theme, "light");
    assert.equal(written.treeIndent, 20);
    assert.equal(written.diffMode, "split");

    const read = await readSettings();
    assert.deepEqual(read, written);
  } finally {
    await clean();
  }
});
