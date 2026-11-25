
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


const { settingsPath } = await import("../src/settings-store.js");
const { GIT } = await import("../src/config.js");
process.env[GIT.ARTIFACTS_DIR_ENV] = await mkdtemp(join(tmpdir(), "settings-e2e-"));
await (await import("node:fs/promises")).rm(settingsPath(), { force: true });
const first = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, symbols: false, dispatchEnabled: false });
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1200, height: 900 }))
  .build();

async function openPage(url) {
  await driver.get(url);
  await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);


  await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 15_000);
  await PAUSE(300);
}
try {
  await check("settings are written to the server, not just localStorage", async () => {
    await openPage(first.url);

    assert.deepEqual(await driver.executeScript(`return [document.getElementById('set-tree-indent').value, getComputedStyle(PR.els.tree).getPropertyValue('--tree-indent').trim()]`), ['5', '5px']);


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

  await check("the toolbar layout button is remembered device-wide", async () => {
    await openPage(first.url);


    await driver.executeScript(`document.querySelector('.js-mode-opt[data-mode="unified"]').click(); return true;`);
    await PAUSE(800);

    const stored = await fetch(new URL("/api/settings", first.url)).then((response) => response.json());
    assert.equal(stored.settings.diffMode, "unified", "the toolbar choice never reached the server");

    await openPage(first.url);
    const state = await driver.executeScript(`return {
      mode: PR.state.diffMode,
      splitTables: document.querySelectorAll('.diff-table.split').length,
      pressed: document.querySelector('.js-mode-opt[data-mode="unified"]').getAttribute('aria-pressed'),
    };`);
    assert.equal(state.mode, "unified", "the toolbar choice was lost after a reload");
    assert.equal(state.splitTables, 0, "the page came back in the other layout");
    assert.equal(state.pressed, "true", "the toolbar does not show the stored layout");
  });

  await check("a stale browser copy does not override the saved settings", async () => {

    // The server holds the person's real choice. A stale localStorage value —
    // what a different port or an older page left behind — must not win.
    await driver.executeScript(`return (function(){
      localStorage.setItem('pr-review:settings:v1', JSON.stringify({ treeIndent: 30, hideViewed: false, theme: 'dark' }));
      return true;
    })();`);
    await openPage(first.url);
    const state = await driver.executeScript(`return {
      treeIndent: PR.state.settings.treeIndent,
      theme: PR.state.settings.theme,
    };`);
    assert.equal(state.treeIndent, 24, "a stale browser indent overrode the saved settings");
    assert.equal(state.theme, "light", "a stale browser theme overrode the saved settings");
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
