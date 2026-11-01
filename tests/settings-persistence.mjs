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
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "ghdb-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({ auth: true, default: String(PR_NUMBER), pullRequests: { [PR_NUMBER]: pullRequestPayload(fixture, PR_NUMBER) } }));
process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;
// Start from a clean settings file so the run does not depend on the machine.
const { settingsPath } = await import("../src/settings-store.js");
await (await import("node:fs/promises")).rm(settingsPath(), { force: true });
const first = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, symbols: false, dispatchEnabled: false });
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1200, height: 900 }))
  .build();
/** Opens a page and waits until it is fully wired (settings loaded, handlers bound). */
async function openPage(url) {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
  // `body.dataset.booted` is set once settings are loaded and the controls are
  // bound, so a change made now is actually handled and saved.
  await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 15_000);
  await PAUSE(300);
}
try {
  await check("settings are written to the server, not just localStorage", async () => {
    await openPage(first.url);

    // Change a few settings through the real controls.
    await driver.executeScript(`return (function(){
      var mode = document.getElementById('set-diff-mode');
      mode.value = 'split';
      mode.dispatchEvent(new Event('change', { bubbles: true }));

      var indent = document.getElementById('set-tree-indent');
      indent.value = '24';
      indent.dispatchEvent(new Event('change', { bubbles: true }));

      var hide = document.getElementById('set-hide-viewed');
      hide.checked = true;
      hide.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })();`);
    await PAUSE(600);

    // The server is the source of truth: a new port must still see them.
    const response = await fetch(new URL("/api/settings", first.url));
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.settings.diffMode, "split", "the server did not store the layout");
    assert.equal(payload.settings.treeIndent, 24, "the server did not store the indent");
    assert.equal(payload.settings.hideViewed, true, "the server did not store hide-viewed");
  });

  await check("unknown and hostile setting keys are not stored", async () => {
    const response = await fetch(new URL("/api/settings", first.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ evil: "<script>", treeIndent: "not a number", theme: "light", treeOpen: "new" }),
    });
    const payload = await response.json();
    assert.equal(payload.settings.evil, undefined, "an unknown key was stored");
    assert.equal(payload.settings.treeIndent, 24, "a non-numeric number was accepted");
    assert.equal(payload.settings.theme, "light");
    assert.equal(payload.settings.treeOpen, "new");
  });

  await check("a different review on the same device keeps the settings", async () => {
    // A second review gets its own port, so localStorage cannot carry anything:
    // the server file must do it.
    const otherFile = join(fixture.repo, "src/another.ts");
    await writeFile(otherFile, "export const another = 1;\n");

    const second = await startReview({ repoPath: fixture.repo, mode: MODE.UNCOMMITTED, includeStaged: false, includeUntracked: true, port: 0, symbols: false, dispatchEnabled: false });
    try {
      assert.notEqual(second.reviewId, first.reviewId, "the two reviews share an id");
      assert.notEqual(second.page.port, first.page.port, "the two reviews share a port");
      await openPage(second.url);

      const state = await driver.executeScript(`return {
        diffMode: PR.state.diffMode,
        treeIndent: PR.state.settings.treeIndent,
        hideViewed: PR.state.settings.hideViewed,
        theme: document.documentElement.getAttribute('data-theme'),
      };`);
      assert.equal(state.diffMode, "split", "the diff layout reset in a new review");
      assert.equal(state.treeIndent, 24, "the tree indent reset in a new review");
      assert.equal(state.hideViewed, true, "hide-viewed reset in a new review");
      assert.equal(state.theme, "light", "the theme reset in a new review");
    } finally {
      await second.page.close();
    }
  });

  await check("the settings survive a page reload", async () => {
    await openPage(first.url);
    const state = await driver.executeScript(`return {
      diffMode: PR.state.diffMode,
      treeIndent: PR.state.settings.treeIndent,
    };`);
    assert.equal(state.diffMode, "split", "the layout was lost after a reload");
    assert.equal(state.treeIndent, 24, "the indent was lost after a reload");
  });

  await check("a corrupt settings file does not break the page", async () => {
    const { writeFile: write, readFile: read } = await import("node:fs/promises");
    const path = settingsPath();
    const backup = await read(path, "utf8").catch(() => null);
    await write(path, "not json{{{", "utf8");

    try {
      await openPage(first.url);
      const ok = await driver.executeScript(`return typeof PR !== 'undefined' && PR.state.files.length > 0;`);
      assert.equal(ok, true, "a corrupt settings file broke the page");
      const errors = await driver.executeScript(`return window.__errors || [];`);
      assert.deepEqual(errors, [], `runtime errors: ${JSON.stringify(errors)}`);
    } finally {
      if (backup !== null) await write(path, backup, "utf8");
      else await (await import("node:fs/promises")).rm(path, { force: true });
    }
  });
} finally {
  await driver.quit();
  await first.page.close();
  await fixture.cleanup();
  await (await import("node:fs/promises")).rm(settingsPath(), { force: true }).catch(() => {});
  await import("node:fs/promises").then((fs) => fs.rm(dbDir, { recursive: true, force: true })).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll settings-persistence checks passed");
}
