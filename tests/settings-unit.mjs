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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readSettings, sanitizeSettings, settingsPath, writeSettings, migrateLegacySettings } from "../src/settings-store.js";
import { GIT } from "../src/config.js";
// The tests must never touch the real per-user file: a machine's actual
// settings live in stableUserRoot() and the user would see them "reset".
const sandbox = await mkdtemp(join(tmpdir(), "settings-unit-"));
const env = { [GIT.ARTIFACTS_DIR_ENV]: sandbox };
const clean = () => rm(settingsPath(env), { force: true }).catch(() => {});
test("the settings file lives outside any repository", () => {
  const path = settingsPath(env);
  assert.ok(/ui-settings\.json$/.test(path), `unexpected path ${path}`);
  assert.ok(!path.includes(".pr-review"), "settings are still stored in the repo folder");
  assert.ok(path.startsWith(sandbox), "settings leaked to the real per-user location");
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
test("sanitizeSettings rejects a non-object", () => {
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings("nope"), {});
  assert.deepEqual(sanitizeSettings(42), {});
});
test("settings from the old temp location are migrated once", async () => {
  const target = await mkdtemp(join(tmpdir(), "settings-new-"));
  const legacy = await mkdtemp(join(tmpdir(), "settings-old-"));
  const legacyEnv = { [GIT.SETTINGS_DIR_ENV]: target, [GIT.ARTIFACTS_DIR_ENV]: legacy };
  await writeFile(join(legacy, "ui-settings.json"), JSON.stringify({ treeWidth: 455, theme: "light" }), "utf8");

  const read = await readSettings(legacyEnv);
  assert.equal(read.treeWidth, 455, "the old temp settings were not carried over");
  assert.equal(read.theme, "light");
  const copied = JSON.parse(await (await import("node:fs/promises")).readFile(join(target, "ui-settings.json"), "utf8"));
  assert.equal(copied.treeWidth, 455, "the migrated file was not written");
});
test("a hand-edited file with a BOM still loads", async () => {
  await clean();
  const { mkdir, writeFile: write } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const path = settingsPath(env);
  await mkdir(dirname(path), { recursive: true });
  await write(path, "\uFEFF" + JSON.stringify({ treeWidth: 410 }), "utf8");
  try {
    assert.equal((await readSettings(env)).treeWidth, 410);
  } finally {
    await clean();
  }
});
test("a corrupt file reads as empty instead of throwing", async () => {
  await clean();
  const { writeFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const path = settingsPath(env);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "not json{{{", "utf8");
  try {
    assert.deepEqual(await readSettings(env), {});
  } finally {
    await clean();
  }
});
