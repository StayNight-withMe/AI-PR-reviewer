/**
 * Opens a PR review page on the mock fixture and checks it renders in a browser.
 *
 * This is the UI half of `test:pr`: the node half checks the diff and the API,
 * this one checks that the page actually shows the PR — badge, files, title,
 * a comment editor and the diff rows — with no JavaScript errors.
 *
 * Run: node tests/pr-page.mjs
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
    // Read through a path filter rather than a CSS attribute selector: a path
    // holds dots and slashes, and the JS filter is unambiguous. Hydration
    // rewrites the cells, so poll instead of reading once.
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

  await check("the page raised no JavaScript error", async () => {
    const errors = await driver.executeScript(`return window.__errors || [];`);
    assert.deepEqual(errors, [], `runtime errors: ${JSON.stringify(errors)}`);
  });

  await check("a deleted file starts collapsed, like GitHub", async () => {
    // A deleted file is collapsed by default (the server asks for it); its diff
    // must still exist and expand on demand.
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
    // The exact source lines are visible, unmodified.
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
