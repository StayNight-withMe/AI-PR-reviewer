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
test("a partial write keeps the other stored keys", async () => {
  await clean();
  try {
    await writeSettings({ theme: "dark", hideViewed: true });
    const after = await writeSettings({ treeIndent: 30 });
    assert.equal(after.treeIndent, 30);
    assert.equal(after.theme, "dark", "an unrelated setting was lost");
    assert.equal(after.hideViewed, true, "an unrelated setting was lost");
  } finally {
    await clean();
  }
});
test("an invalid value never overwrites the good stored one", async () => {
  await clean();
  try {
    await writeSettings({ treeIndent: 24 });
    const after = await writeSettings({ treeIndent: "not a number" });
    assert.equal(after.treeIndent, 24, "a bad value erased the stored one");
  } finally {
    await clean();
  }
});
test("sanitizeSettings drops unknown keys and wrong types", () => {
  const clean = sanitizeSettings({
    theme: "light",
    evil: "<script>",
    treeIndent: "12",
    hideViewed: "yes",
    largeFileLines: 400,
    "constructor": "x",
    __proto__: { polluted: true },
  });
  assert.equal(clean.evil, undefined, "an unknown key survived");
  assert.equal(clean.hideViewed, undefined, "a wrong boolean type survived");
  assert.equal(clean.treeIndent, 12, "a numeric string was not coerced");
  assert.equal(clean.largeFileLines, 400);
  assert.equal(clean.theme, "light");
});
