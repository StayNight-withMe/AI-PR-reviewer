
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { startReview } from "../src/core.js";
import { MODE, GH } from "../src/config.js";
const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
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
const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: true });
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 }))
  .build();
try {
  console.log(`page: ${started.url}`);

  await check("the page loads with the PR badge linking to GitHub", async () => {
    await driver.get(started.url);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
    const badge = await driver.findElement(By.css("a.pr-badge"));
    assert.ok((await badge.getText()).includes(`#${PR_NUMBER}`), "the badge does not show the number");
    assert.match(await badge.getAttribute("href"), /github\.com\/.*\/pull\/\d+$/);
  });

  await check("the header shows the PR title, not the checked-out branch", async () => {
    const h1 = await driver.findElement(By.css("h1")).then((e) => e.getText());
    assert.ok(h1.includes(`PR #${PR_NUMBER}`), `unexpected header: ${h1}`);
    assert.ok(h1.includes("Add the login module"), `unexpected header: ${h1}`);
  });

  await check("every changed file is rendered, including the one with a space", async () => {
    const paths = await driver.executeScript(
      `return [...document.querySelectorAll('.diff-file')].map((s) => s.dataset.path);`,
    );
    for (const expected of ["src/app.ts", "src/login.ts", "src/removed.ts", "data/with space.txt", "docs/new doc.md"]) {
      assert.ok(paths.includes(expected), `${expected} is not rendered (got ${paths.join(", ")})`);
    }
  });

  await check("the diff shows the added line from the PR head", async () => {



    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt += 1) {
      ready = await driver.executeScript(`return (function(){
        var s = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
          .filter(function(n){ return n.dataset.path === 'src/app.ts'; })[0];
        return !!s && s.textContent.indexOf('ready = true') !== -1;
      })();`);
      if (!ready) await PAUSE(250);
    }
    assert.equal(ready, true, "the PR head line never appeared in the diff");
  });

  await check("a comment can be added on a PR line", async () => {
    await driver.executeScript(`return (function(){
      var s = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function(n){ return n.dataset.path === 'src/app.ts'; })[0];
      var plus = s.querySelectorAll('.line-plus');
      plus[plus.length - 1].click();
      return true;
    })();`);
    await PAUSE(200);
    const editors = await driver.findElements(By.css(".js-editor textarea"));
    assert.equal(editors.length, 1, "the comment editor did not open");
    await driver.executeScript(`document.querySelector('.js-editor .js-cancel').click(); return true;`);
  });

  await check("the submit dialog offers publishing to GitHub and defaults to Comment", async () => {
    const state = await driver.executeScript(`return (function(){
      document.getElementById('btn-submit').click();
      var modal = document.getElementById('dispatch-modal');
      var checked = modal.querySelector('input[name="review-verdict"]:checked');
      var out = {
        open: modal.classList.contains('show'),
        hasPublish: !!document.getElementById('btn-publish-github'),
        // A pull request review is published to GitHub; it must not offer the
        // local save or the AI hand-off.
        hasSubmitLocally: !!document.getElementById('btn-dispatch-submit'),
        hasSendSwitch: !!document.getElementById('dispatch-send'),
        footerButtons: [].slice.call(modal.querySelectorAll('.modal-footer button')).map(function (b) { return b.textContent.trim(); }),
        verdicts: [].slice.call(modal.querySelectorAll('input[name="review-verdict"]')).map(function (i) { return i.value; }),
        defaultVerdict: checked ? checked.value : null,
      };
      modal.querySelector('.js-close-modal').click();
      return out;
    })();`);
    assert.equal(state.open, true, "the dialog did not open");
    assert.equal(state.hasPublish, true, "a pull request review must be publishable from the page");
    assert.equal(state.hasSubmitLocally, false, "a pull request review must not offer a local save");
    assert.equal(state.hasSendSwitch, false, "a pull request review must not offer the AI hand-off");
    assert.deepEqual(state.footerButtons, ["Cancel", "Publish to GitHub"], `unexpected dialog buttons: ${state.footerButtons.join(", ")}`);
    assert.deepEqual(state.verdicts.sort(), ["APPROVE", "COMMENT", "REQUEST_CHANGES"]);
    assert.equal(state.defaultVerdict, "COMMENT", "posting notes must not block the pull request by default");
  });

  await check("publishing sends the inline comment to the pull request", async () => {

    await driver.executeScript(`return (function(){
      var s = [].slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (n) { return n.dataset.path === 'src/app.ts'; })[0];
      var plus = s.querySelectorAll('.line-plus');
      plus[plus.length - 1].click();
      return true;
    })();`);
    await PAUSE(300);
    await driver.executeScript(`return (function(){
      var ta = document.querySelector('.js-editor textarea');
      ta.value = 'Please rename this to ready';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.js-editor .js-save').click();
      return true;
    })();`);
    await PAUSE(400);

    await driver.executeScript(`document.getElementById('btn-submit').click(); return true;`);
    await PAUSE(200);

    const locked = await driver.executeScript(`return (function(){
      var button = document.getElementById('btn-publish-github');
      button.click();
      var afterFirst = button.disabled;
      button.click();
      return afterFirst;
    })();`);
    assert.equal(locked, true, "the publish button did not lock, so a double click can post twice");

    let posted = null;
    for (let attempt = 0; attempt < 80 && !posted; attempt += 1) {
      const db = JSON.parse(await readFile(dbPath, "utf8"));
      posted = (db.publishedReviews ?? []).at(-1) ?? null;
      if (!posted) await PAUSE(250);
    }
    assert.ok(posted, "nothing reached GitHub");
    assert.equal(posted.number, String(PR_NUMBER));
    assert.equal(posted.repo, "acme/fixture");
    assert.equal(posted.commit_id, fixture.commits.f2);
    assert.equal(posted.event, "COMMENT");
    assert.equal(JSON.parse(await readFile(dbPath, "utf8")).publishedReviews.length, 1, "a double click posted twice");
    assert.equal(posted.comments.length, 1, `expected one inline comment: ${JSON.stringify(posted.comments)}`);
    assert.equal(posted.comments[0].path, "src/app.ts");
    assert.match(posted.comments[0].body, /rename this to ready/);
    assert.ok(posted.comments[0].line > 0, "the inline comment carries no line");


    let shown = "";
    for (let attempt = 0; attempt < 60; attempt += 1) {
      shown = await driver.executeScript(`return (document.getElementById('publish-result') || {}).textContent || '';`);
      if (/Published to GitHub/i.test(shown)) break;
      await PAUSE(250);
    }
    assert.match(shown, /Published to GitHub/i, `unexpected result text: ${shown}`);
  });

  await check("a second publish does not post the same comment twice", async () => {
    const before = JSON.parse(await readFile(dbPath, "utf8")).publishedReviews.length;
    await driver.executeScript(`return (function(){
      var button = document.getElementById('btn-publish-github');
      button.disabled = false;
      button.click();
      return true;
    })();`);
    await PAUSE(1200);
    const after = JSON.parse(await readFile(dbPath, "utf8")).publishedReviews;
    assert.equal(after.length, before, "the same review was published again");
    const shown = await driver.executeScript(`return (document.getElementById('publish-result') || {}).textContent || '';`);
    assert.match(shown, /Already published|Nothing new to publish/i, `unexpected result text: ${shown}`);
  });

  await check("a failed publish keeps the comments and says what happened", async () => {

    const db = JSON.parse(await readFile(dbPath, "utf8"));
    await writeFile(dbPath, JSON.stringify({ ...db, auth: false }));

    const outcome = await driver.executeScript(`return (async function(){
      var host = [].slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (n) { return n.dataset.path === 'src/login.ts'; })[0];
      host.querySelector('.line-plus').click();
      await new Promise(function (r) { setTimeout(r, 200); });
      var ta = document.querySelector('.js-editor textarea');
      ta.value = 'This needs a test';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.js-editor .js-save').click();
      await new Promise(function (r) { setTimeout(r, 400); });
      document.getElementById('btn-submit').click();
      await new Promise(function (r) { setTimeout(r, 150); });
      document.getElementById('btn-publish-github').click();
      return true;
    })();`);
    assert.equal(outcome, true);

    let text = "";
    for (let attempt = 0; attempt < 80; attempt += 1) {
      text = await driver.executeScript(`return (document.getElementById('publish-result') || {}).textContent || '';`);
      if (/Could not publish/i.test(text)) break;
      await PAUSE(250);
    }
    assert.match(text, /Could not publish/i, `the failure was not reported: ${text}`);
    assert.match(text, /auth|login/i, `the reason is not useful: ${text}`);


    const kept = await driver.executeScript(`return (function(){
      return {
        modal: document.getElementById('dispatch-modal').classList.contains('show'),
        comments: [...document.querySelectorAll('.comment-box')].filter(function (b) { return !b.classList.contains('js-editor'); }).length,
        retry: !document.getElementById('btn-publish-github').disabled,
      };
    })();`);
    assert.equal(kept.modal, true, "the dialog closed on failure");
    assert.ok(kept.comments >= 2, `comments were lost: ${kept.comments}`);
    assert.equal(kept.retry, true, "the publish button stayed disabled, so the reviewer cannot retry");
    await writeFile(dbPath, JSON.stringify({ ...db, auth: true }));
  });

  await check("a reopened review does not repost comments that already went to GitHub", async () => {

    await driver.get(started.url);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
    await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 15_000);
    await PAUSE(400);

    const restored = await driver.executeScript(`return PR.state.published.size;`);
    assert.ok(restored >= 1, `the published mark was lost on reload: ${restored}`);

    const before = JSON.parse(await readFile(dbPath, "utf8")).publishedReviews.length;
    await driver.executeScript(`document.getElementById('btn-submit').click(); return true;`);
    await PAUSE(200);
    await driver.executeScript(`document.getElementById('btn-publish-github').click(); return true;`);

    let posted = null;
    for (let attempt = 0; attempt < 80 && !posted; attempt += 1) {
      const db = JSON.parse(await readFile(dbPath, "utf8"));
      if (db.publishedReviews.length > before) posted = db.publishedReviews.at(-1);
      else await PAUSE(250);
    }
    assert.ok(posted, "the new comment was not published");
    assert.equal(posted.comments.length, 1, `only the new comment may be posted: ${JSON.stringify(posted.comments)}`);
    assert.match(posted.comments[0].body, /needs a test/);
  });

  await check("a viewed file is written to GitHub and restored from it", async () => {
    // Start from a clean GitHub viewed state and a page that shows every file,
    // so the assertion is about this page and not about leftover settings.
    const cleanDb = JSON.parse(await readFile(dbPath, "utf8"));
    cleanDb.viewed = {};
    await writeFile(dbPath, JSON.stringify(cleanDb));

    await driver.get(started.url);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
    await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 15_000);
    await PAUSE(800);

    await driver.executeScript(`return (function(){
      PR.state.settings.hideViewed = false;
      PR.state.settings.collapseViewed = false;
      PR.applySettings();
      PR.renderFileList();
      return true;
    })();`);
    await PAUSE(300);

    const before = await driver.executeScript(`return PR.state.viewed.size;`);
    assert.equal(before, 0, "a file is viewed before anything was checked");

    // Click the Viewed checkbox of the app file and wait for GitHub to store it.
    await driver.executeScript(`return (function(){
      var section = [].slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (n) { return n.dataset.path === 'src/app.ts'; })[0];
      section.querySelector('.viewed-wrap').click();
      return true;
    })();`);

    let stored = null;
    for (let attempt = 0; attempt < 60 && !stored; attempt += 1) {
      const db = JSON.parse(await readFile(dbPath, "utf8"));
      stored = db.viewed?.[String(PR_NUMBER)]?.["src/app.ts"] ?? null;
      if (!stored) await PAUSE(250);
    }
    assert.equal(stored, "VIEWED", "the viewed mark never reached GitHub");

    // Reload: the checkbox must come back from GitHub, not from localStorage.
    await driver.executeScript(`localStorage.clear(); return true;`);
    await driver.get(started.url);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
    await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 15_000);

    await driver.executeScript(`return (function(){
      PR.state.settings.hideViewed = false;
      PR.state.settings.collapseViewed = false;
      PR.applySettings();
      PR.renderFileList();
      return true;
    })();`);
    await PAUSE(300);

    let restored = "";
    let debug = null;
    for (let attempt = 0; attempt < 60 && !restored; attempt += 1) {
      const state = await driver.executeScript(`return (function(){
        var section = [].slice.call(document.querySelectorAll('.diff-file'))
          .filter(function (n) { return n.dataset.path === 'src/app.ts'; })[0];
        return {
          hasSection: !!section,
          booted: document.body.dataset.booted,
          viewed: PR.state.viewed.size,
          has: PR.state.viewed.has('src/app.ts'),
          cls: section ? section.classList.contains('is-viewed') : null,
          hasPr: !!(PR.DATA && PR.DATA.pr),
          hasSync: typeof PR.syncViewedFromGitHub,
          changed: PR.state.changedPaths.has('src/app.ts'),
        };
      })()`);
      debug = JSON.stringify(state);
      if (state.has && state.cls) restored = "yes";
      if (!restored) await PAUSE(250);
    }
    assert.equal(restored, "yes", `a file viewed on GitHub was not restored after clearing localStorage: ${debug}`);

    // Unchecking must clear it on GitHub too.
    await driver.executeScript(`return PR.toggleViewed('src/app.ts');`, true);
    let cleared = "VIEWED";
    for (let attempt = 0; attempt < 60 && cleared === "VIEWED"; attempt += 1) {
      const db = JSON.parse(await readFile(dbPath, "utf8"));
      cleared = db.viewed?.[String(PR_NUMBER)]?.["src/app.ts"] ?? "UNVIEWED";
      if (cleared === "VIEWED") await PAUSE(250);
    }
    assert.notEqual(cleared, "VIEWED", "unchecking did not clear the mark on GitHub");
  });

  await check("the page raised no JavaScript error", async () => {
    const errors = await driver.executeScript(`return window.__errors || [];`);
    assert.deepEqual(errors, [], `runtime errors: ${JSON.stringify(errors)}`);
  });

  await check("a deleted file starts collapsed, like GitHub", async () => {


    const state = await driver.executeScript(`return (function(){
      var s = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function(n){ return n.dataset.path === 'src/removed.ts'; })[0];
      if (!s) return null;
      var collapsed = s.classList.contains('collapsed');
      var hasDiff = s.textContent.indexOf('removed = true') !== -1;
      return { collapsed: collapsed, hasDiff: hasDiff };
    })();`);
    assert.ok(state, "the deleted file is not on the page");
    assert.equal(state.collapsed, true, "a deleted file should start collapsed");
    assert.equal(state.hasDiff, true, "the deleted file has no diff content");
  });

  await check("the viewer shows the file's real lines with syntax colours", async () => {
    await driver.get(new URL("/file?path=src/app.ts", started.url).toString());
    await driver.wait(until.elementLocated(By.css(".viewer-table")), 15_000);
    await PAUSE(700);

    const shape = await driver.executeScript(`return (function(){
      var cells = Array.prototype.slice.call(document.querySelectorAll('.v-code'));
      return {
        spans: document.querySelectorAll('.v-code span').length,
        // Highlighting must not change what the file says.
        text: cells.map(function (c) { return c.textContent; }).join('\\n'),
        tinted: document.querySelectorAll('.v-code.row-add, .v-code.row-del, tr.row-add, tr.row-del').length,
      };
    })();`);

    assert.ok(shape.spans > 0, "the viewer shows the file without any syntax colour");
    assert.equal(shape.tinted, 0, "the viewer tinted lines as if it were a diff");

    assert.ok(shape.text.includes("export const ready = true;"), `unexpected viewer text: ${shape.text.slice(0, 200)}`);
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
  console.log("\nAll PR page checks passed");
}
