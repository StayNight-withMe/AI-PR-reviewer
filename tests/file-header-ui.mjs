/**
 * Browser checks for two file-header affordances:
 *
 *   1. The full path tooltip — the row truncates a long path, so hovering must
 *      show the whole path in a readable box.
 *   2. The "more actions" menu — "Expand all" lives in a three-dots menu and is
 *      offered ONLY when the file still hides something.
 *
 * Runs against the PR fixture, so it needs no repository, gh or network.
 *
 * Run: node tests/file-header-ui.mjs
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { startReview } from "../src/core.js";
import { MODE, GH } from "../src/config.js";
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
const dbDir = await mkdtemp(join(tmpdir(), "pr-review-ghdb-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
}));
process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;
const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: false });
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 900, height: 900 }))
  .build();
try {
  await driver.get(started.url);
  await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
  await PAUSE(2500);

  await check("no native title on the path (the custom tooltip replaces it)", async () => {
    const hasTitle = await driver.executeScript(
      `return !!document.querySelector('.diff-file-header .path[title]');`,
    );
    assert.equal(hasTitle, false, "the path still carries a native title");
  });

  await check("hovering the path shows a readable full-path tooltip", async () => {
    const path = await driver.executeScript(`return (function(){
      var p = document.querySelector('.diff-file-header .path');
      p.scrollIntoView({ block: 'center' });
      return p.getAttribute('data-full-path');
    })();`);

    // A real hover so the mouseover handler fires.
    const element = await driver.findElement(By.css(".diff-file-header .path"));
    await driver.actions().move({ origin: element }).perform();
    await PAUSE(700);

    const tip = await driver.executeScript(`return (function(){
      var box = document.querySelector('.path-tip');
      if (!box) return null;
      var style = getComputedStyle(box);
      return {
        text: box.textContent,
        fontSize: parseFloat(style.fontSize),
        width: box.getBoundingClientRect().width,
        visible: style.display !== 'none' && box.getBoundingClientRect().height > 0,
        dir: (box.querySelector('.path-tip-dir') || {}).textContent,
        name: (box.querySelector('.path-tip-name') || {}).textContent,
      };
    })();`);

    assert.ok(tip, "no tooltip appeared");
    assert.equal(tip.visible, true, "the tooltip is not visible");
    assert.equal(tip.text, path, "the tooltip does not show the full path");
    assert.ok(tip.fontSize >= 12, `the tooltip font is too small: ${tip.fontSize}px`);
    assert.ok(tip.name === path.split("/").pop(), "the file name is not separated from the directory");
    assert.ok(tip.dir.length > 0, "the directory part is empty");
  });

  await check("the tooltip disappears when the pointer leaves", async () => {
    await driver.actions().move({ x: 5, y: 5, origin: "viewport" }).perform();
    await PAUSE(500);
    const still = await driver.executeScript(`return !!document.querySelector('.path-tip');`);
    assert.equal(still, false, "the tooltip stayed after the pointer left");
  });

  await check("the header no longer shows a standalone Expand all button", async () => {
    const visible = await driver.executeScript(`return (function(){
      var all = Array.prototype.slice.call(document.querySelectorAll('.diff-file-header .js-expand-all'));
      return all.filter(function (b) { return !b.closest('[hidden]'); }).length;
    })();`);
    assert.equal(visible, 0, "an Expand all button is still visible in the header");
  });

  await check("a file with hidden regions offers Expand all inside the menu", async () => {
    // Force folding: a low threshold makes every gap a candidate.
    await driver.executeScript(`(PR.state.settings.contextCollapseLines = 1, PR.renderFileList(), true)`);
    await PAUSE(2500);

    const opened = await driver.executeScript(`return (function(){
      var sections = Array.prototype.slice.call(document.querySelectorAll('.diff-file'));
      var section = sections.filter(function (s) {
        return !s.classList.contains('is-deferred') && s.querySelector('.hunk-expander');
      })[0];
      if (!section) return { found: false };
      var button = section.querySelector('.js-file-menu');
      if (!button) return { found: true, noMenu: true };
      button.click();
      var pop = section.querySelector('.file-menu-pop');
      return {
        found: true,
        open: pop && !pop.hidden,
        hasExpand: !!section.querySelector('.file-menu-pop .js-expand-all'),
        expanders: section.querySelectorAll('.hunk-expander').length,
      };
    })();`);

    assert.ok(opened.found, "no file with a hidden region was found");
    assert.ok(!opened.noMenu, "the file hides regions but has no menu button");
    assert.equal(opened.open, true, "the menu did not open");
    assert.equal(opened.hasExpand, true, "Expand all is missing from the menu");
  });

  await check("Expand all from the menu reveals the file", async () => {
    const before = await driver.executeScript(`return (function(){
      var s = document.querySelector('.diff-file:not(.is-deferred)');
      return s.querySelectorAll('td.diff-code').length;
    })();`);

    await driver.executeScript(`return (function(){
      var section = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (s) { return s.querySelector('.file-menu-pop .js-expand-all'); })[0];
      if (!section) return false;
      section.querySelector('.file-menu-pop .js-expand-all').click();
      return true;
    })();`);
    await PAUSE(2000);

    const state = await driver.executeScript(`return (function(){
      var section = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (s) { return !s.classList.contains('is-deferred'); })[0];
      return {
        bars: section.querySelectorAll('.hunk-expander').length,
        hasExpand: !!section.querySelector('.file-menu-pop .js-expand-all'),
      };
    })();`);

    assert.equal(state.bars, 0, "a hidden region is still collapsed after Expand all");
    assert.equal(state.hasExpand, false, "Expand all is still offered although nothing is hidden");

    void before;
  });

  await check("a file with nothing to expand has no Expand all entry", async () => {
    const result = await driver.executeScript(`return (function(){
      var sections = Array.prototype.slice.call(document.querySelectorAll('.diff-file'));
      var flat = sections.filter(function (s) {
        return !s.classList.contains('is-deferred') && !s.querySelector('.hunk-expander');
      })[0];
      if (!flat) return { skipped: true };
      return { skipped: false, hasExpand: !!flat.querySelector('.file-menu-pop .js-expand-all') };
    })();`);
    if (result.skipped) return; // no fully-visible file on this page
    assert.equal(result.hasExpand, false, "a file with nothing to expand still offers Expand all");
  });

  await check("the file header sticks while the file is scrolled", async () => {
    const result = await driver.executeScript(`return (function(){
      var section = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (s) { return !s.classList.contains('is-deferred') && s.querySelectorAll('td.diff-code').length > 20; })[0];
      if (!section) return { skipped: true };

      var header = section.querySelector('.diff-file-header');
      var sticky = getComputedStyle(header).position;
      // Scroll so the file's body is well past the top of the viewport.
      section.scrollIntoView({ block: 'start' });
      window.scrollBy(0, 600);

      var rect = header.getBoundingClientRect();
      var sectionRect = section.getBoundingClientRect();
      var toolbar = document.querySelector('.gh-sticky-toolbar');
      var toolbarBottom = toolbar ? toolbar.getBoundingClientRect().bottom : 0;

      return {
        skipped: false,
        sticky: sticky,
        headerTop: Math.round(rect.top),
        toolbarBottom: Math.round(toolbarBottom),
        sectionTop: Math.round(sectionRect.top),
        sectionBottom: Math.round(sectionRect.bottom),
        visible: rect.top >= 0 && rect.bottom <= window.innerHeight,
        headerStillInSection: rect.top >= sectionRect.top - 2 && rect.bottom <= sectionRect.bottom + 2,
      };
    })();`);

    if (result.skipped) return; // no tall file on this page
    assert.equal(result.sticky, "sticky", "the file header is not position: sticky");
    assert.ok(result.visible, `the header scrolled out of view (top=${result.headerTop})`);
    assert.ok(result.headerTop >= result.toolbarBottom - 2, `the header hides under the toolbar (${result.headerTop} < ${result.toolbarBottom})`);
  });

  await check("the three-dots trigger is visible without hovering", async () => {
    const visible = await driver.executeScript(`return (function(){
      var button = document.querySelector('.diff-file-header .js-file-menu');
      if (!button) return { found: false };
      var style = getComputedStyle(button);
      return { found: true, opacity: parseFloat(style.opacity), width: button.getBoundingClientRect().width };
    })();`);
    assert.ok(visible.found, "the more-actions trigger is missing");
    assert.equal(visible.opacity, 1, `the trigger is hidden until hover (opacity ${visible.opacity})`);
    assert.ok(visible.width > 0, "the trigger has no size");
  });

  await check("View file and Add file comment live in the menu", async () => {
    const items = await driver.executeScript(`return (function(){
      var pop = document.querySelector('.diff-file-header .file-menu-pop');
      if (!pop) return null;
      return Array.prototype.slice.call(pop.children).map(function (node) {
        return { cls: node.className, text: node.textContent.trim() };
      });
    })();`);
    assert.ok(items && items.length >= 2, "the menu is empty");
    const texts = items.map((item) => item.text);
    assert.ok(texts.includes("View file"), `View file is missing: ${texts.join(", ")}`);
    assert.ok(texts.includes("Add file comment"), `Add file comment is missing: ${texts.join(", ")}`);
    assert.ok(!texts.includes("Copy path"), "Copy path should be an icon next to the path, not a menu item");
  });

  await check("the path keeps its own copy button", async () => {
    const hasCopy = await driver.executeScript(`return !!document.querySelector('.diff-file-header .path-group .js-copy-path');`);
    assert.equal(hasCopy, true, "the copy-path icon is gone from the path");
  });

  await check("the standalone View file / Add comment buttons are gone from the header", async () => {
    const strays = await driver.executeScript(`return (function(){
      var header = document.querySelector('.diff-file-header');
      return {
        openFile: header.querySelectorAll(':scope > .js-open-file').length,
        comment: header.querySelectorAll(':scope > .js-file-comment').length,
      };
    })();`);
    assert.equal(strays.openFile, 0, "a standalone View file button is still in the header");
    assert.equal(strays.comment, 0, "a standalone Add file comment button is still in the header");
  });

  await check("no JavaScript error on the page", async () => {
    const errors = await driver.executeScript(`return window.__errors || [];`);
    assert.deepEqual(errors, [], `runtime errors: ${JSON.stringify(errors)}`);
  });
} finally {
  await driver.quit();
  await started.page.close();
  await fixture.cleanup();
  await import("node:fs/promises").then((fs) => fs.rm(dbDir, { recursive: true, force: true })).catch(() => {});
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll file-header checks passed");
}
