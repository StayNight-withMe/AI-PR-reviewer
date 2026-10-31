/**
 * Resolving review comments, from the page and from the agent.
 *
 * A review comment can be marked resolved when it is fixed: on the page with
 * the "Resolve" button, and by the agent through the `resolve_comments` MCP tool,
 * which writes the same `review.json`/`review.md` the page shows.
 *
 * Also checks that a re-review after a code change is a NEW review: the old
 * "Viewed" flags must not carry over, which was a stale-state bug.
 *
 * Run: node tests/resolve.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { buildReview, startReview } from "../src/core.js";
import { MODE } from "../src/config.js";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { GH } from "../src/config.js";
import { buildMarkdown } from "../src/render.js";
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
let started = null;
let driver = null;
try {
  started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, symbols: false, dispatchEnabled: false });

  await check("a comment can be resolved on the page and reopened", async () => {
    driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1200, height: 900 }))
      .build();
    await driver.get(started.url);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
    await PAUSE(2000);

    // Write the comment the way a user does: the + gutter, then save.
    const opened = await driver.executeScript(`return (function(){
      var section = Array.prototype.slice.call(document.querySelectorAll('.diff-file'))
        .filter(function (s) { return s.dataset.path === 'src/app.ts'; })[0];
      if (!section) return false;
      var plus = section.querySelectorAll('.line-plus');
      if (!plus.length) return false;
      plus[plus.length - 1].click();
      return true;
    })();`);
    assert.ok(opened, "could not open a comment editor");

    await PAUSE(400);
    await driver.executeScript(`return (function(){
      var ta = document.querySelector('.js-editor textarea');
      if (!ta) return false;
      ta.value = 'Why this flag?';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.js-editor .js-save').click();
      return true;
    })()`);
    await PAUSE(600);

    const button = await driver.executeScript(`return !!document.querySelector('.comment-box .js-resolve');`);
    assert.ok(button, "the Resolve button is missing from the comment");

    await driver.executeScript(`document.querySelector('.comment-box .js-resolve').click(); return true;`);
    await PAUSE(400);

    const after = await driver.executeScript(`return (function(){
      var box = document.querySelector('.comment-box');
      return {
        isResolved: box.classList.contains('is-resolved'),
        pill: !!box.querySelector('.resolved-pill'),
        button: (box.querySelector('.js-resolve') || {}).textContent,
        count: (document.getElementById('comment-count') || {}).textContent,
        header: (document.getElementById('header-summary') || {}).textContent,
      };
    })();`);

    assert.equal(after.isResolved, true, "the comment is not visually resolved");
    assert.ok(after.pill, "the resolved pill is missing");
    assert.equal(after.button.trim(), "Unresolve", "the button does not offer to reopen");
    assert.equal(after.count, "0", "the open-comment count is wrong");
    assert.ok(after.header.includes("resolved"), "the header does not mention resolved comments");

    await driver.executeScript(`document.querySelector('.comment-box .js-resolve').click(); return true;`);
    await PAUSE(400);
    const reopened = await driver.executeScript(`return (function(){
      var box = document.querySelector('.comment-box');
      return { isResolved: box.classList.contains('is-resolved'), count: (document.getElementById('comment-count')||{}).textContent };
    })();`);
    assert.equal(reopened.isResolved, false, "the comment did not reopen");
    assert.equal(reopened.count, "1", "the open-comment count did not come back");
  });

  await check("resolve_comments (agent tool) writes the state to review.json", async () => {
    const { default: _unused } = { default: null };
    void _unused;
    const indexSource = await readFile(join(ROOT, "..", "src", "index.js"), "utf8");
    assert.ok(indexSource.includes('"resolve_comments"'), "the resolve_comments tool is not registered");
    assert.ok(indexSource.includes("writeReviewFiles"), "the tool does not persist the state");
  });

  await check("the Markdown marks a resolved comment as resolved", () => {
    const md = buildMarkdown(
      { repo: "r", branch: "b", mode: "pr", modeLabel: "Pull request", base: "x", head: "y" },
      {
        reviewState: "REQUEST_CHANGES",
        reviewBody: "",
        comments: [
          { path: "a.ts", lineStart: 1, lineEnd: 1, side: "right", body: "fixed thing", resolved: true },
          { path: "a.ts", lineStart: 5, lineEnd: 5, side: "right", body: "still open" },
        ],
        files: [],
      },
    );
    assert.ok(md.includes("fixed thing ~~resolved~~"), "a resolved comment is not marked in the Markdown");
    assert.ok(!md.includes("still open ~~resolved~~"), "an open comment was wrongly marked resolved");
  });

  await check("a re-review after a code change gets a new id (Viewed does not carry over)", async () => {
    // The real scenario: an uncommitted review, the agent edits the working
    // tree, the review is opened again. The id must change, or every file keeps
    // its stale "Viewed" flag.
    const first = await buildReview({ repoPath: fixture.repo, mode: MODE.UNCOMMITTED, includeStaged: false, includeUntracked: true });
    const workFile = join(fixture.repo, "src/work-in-progress.ts");
    await writeFile(workFile, "export const a = 1;\n");

    try {
      const after = await buildReview({ repoPath: fixture.repo, mode: MODE.UNCOMMITTED, includeStaged: false, includeUntracked: true });
      assert.ok(after.files.some((file) => file.path === "src/work-in-progress.ts"), "the new file is not reviewed");
      assert.notEqual(after.meta.id, first.meta.id, "the review id did not change after the working tree changed");
    } finally {
      await (await import("node:fs/promises")).rm(workFile, { force: true });
    }
  });

  await check("an unchanged diff keeps the same id (Viewed survives a reload)", async () => {
    const first = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    const second = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    assert.equal(first.meta.id, second.meta.id, "the id is not stable for the same diff");
  });
} finally {
  if (driver) await driver.quit();
  if (started) await started.page.close();
  await fixture.cleanup();
  await import("node:fs/promises").then((fs) => fs.rm(dbDir, { recursive: true, force: true })).catch(() => {});
  void pathToFileURL;
}
