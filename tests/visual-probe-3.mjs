/**
 * Third visual probe: empty states, resolved and outdated comments, many
 * comments in the sidebar, split view on a narrow screen, and the deferred
 * file placeholder.
 *
 * Run: node tests/visual-probe-3.mjs
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);
const OUT = "Z:\\system\\temp\\pr-review-visual-3";

const FILE = Array.from({ length: 30 }, (_, i) => `export const value${i + 1} = ${i + 1};`).join("\n") + "\n";
const BIG = Array.from({ length: 700 }, (_, i) => `export const big${i + 1} = ${i + 1};`).join("\n") + "\n";

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-visual3-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "small.ts"), FILE);
  await writeFile(join(root, "src", "big.ts"), BIG);
  await git("add", "-A");
  await git("commit", "-m", "init");

  await writeFile(join(root, "src", "small.ts"), FILE.replace("value3 = 3", "value3 = 333"));
  await writeFile(join(root, "src", "big.ts"), BIG.replace("big300 = 300", "big300 = 3000"));
  await git("add", "-A");
  await git("commit", "-m", "change two files");

  return { root, git };
}

const fixture = await createRepository();
for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION", "PR_REVIEW_SESSION"]) delete process.env[name];
process.env[GIT.ARTIFACTS_DIR_ENV] = join(fixture.root, "artifacts");

const base = (await fixture.git("rev-parse", "HEAD~1")).stdout.trim();
const review = await startReview({
  repoPath: fixture.root, mode: MODE.RANGE, base, head: "HEAD",
  port: 0, symbols: true, dispatchEnabled: false, sessionId: "",
});

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const MEASURE = `return (function () {
  var vw = window.innerWidth;
  var out = { viewport: vw + 'x' + window.innerHeight, offenders: [], overlaps: [], clipped: [], tinyTouch: [] };
  var scrollsSideways = function (el) {
    for (var p = el.parentElement; p; p = p.parentElement) {
      var s = getComputedStyle(p);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') return true;
    }
    return false;
  };
  document.querySelectorAll('body *').forEach(function (el) {
    if (el.getClientRects().length === 0) return;
    var b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) return;
    if (b.right > vw + 1 && !scrollsSideways(el)) {
      out.offenders.push(String(el.className).slice(0, 40) + '#' + el.id + '@' + Math.round(b.right));
    }
    var st = getComputedStyle(el);
    if (el.children.length === 0 && (el.textContent || '').trim() &&
        st.overflow !== 'visible' && st.textOverflow !== 'ellipsis' &&
        el.scrollWidth > el.clientWidth + 2) {
      out.clipped.push(String(el.className).slice(0, 40) + ' [' + (el.textContent || '').trim().slice(0, 24) + ']');
    }
    // A tap target smaller than 24px is hard to hit with a finger.
    if (b.width > 0 && b.width < 24 && b.height < 24 && el.tagName === 'BUTTON') {
      out.tinyTouch.push(String(el.className).slice(0, 30) + '#' + el.id + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
    }
  });
  var piled = function (a, b, label) {
    if (!a || !b) return;
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return;
    var x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    var y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (x > 1 && y > 1) out.overlaps.push(label + ' ' + Math.round(x) + 'x' + Math.round(y));
  };
  var bar = document.querySelector('.action-bar .status');
  var barButtons = document.querySelector('.action-bar #btn-copy-path');
  piled(bar, barButtons, 'action bar status over copy');
  return out;
})()`;

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless"))
  .build();

const results = [];
const shot = async (name) => writeFile(join(OUT, `${name}.png`), await driver.takeScreenshot(), "base64");
const waitReady = async () => {
  await driver.wait(async () => {
    try {
      return await driver.executeScript(
        `return document.body.dataset.booted === '1' && [...document.querySelectorAll('.diff-file')].every(s => s.dataset.hydrated === '1')`);
    } catch { return false; }
  }, 60000);
  await new Promise((r) => setTimeout(r, 900));
};
const record = async (size, state) => {
  results.push({ size, state, ...(await driver.executeScript(MEASURE)) });
};

try {
  await driver.manage().window().setRect({ width: 1440, height: 900 });
  await driver.get(review.url);
  await waitReady();

  // Empty filter result: the message must be readable and centred.
  await driver.executeScript(`(function () {
    var input = document.getElementById('filter-input');
    input.value = 'nothing-matches-this';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));
  await record("desktop-1440", "empty-filter");
  await shot("empty-filter");
  await driver.executeScript(`(function () {
    var input = document.getElementById('filter-input');
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  // Search with no results.
  await driver.executeScript(`document.getElementById('btn-search').click(); return true;`);
  await new Promise((r) => setTimeout(r, 300));
  await driver.executeScript(`(function () {
    var field = document.getElementById('search-input');
    field.value = 'zzzznotthere';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  await record("desktop-1440", "empty-search");
  await shot("empty-search");
  await driver.executeScript(`document.getElementById('btn-search').click(); return true;`);

  // Many comments, one resolved and one outdated.
  await driver.executeScript(`(async function () {
    var section = [...document.querySelectorAll('.diff-file')].find(function (s) { return s.querySelector('.line-plus'); });
    var plus = section.querySelectorAll('.line-plus[data-side="right"]');
    async function comment(button, text) {
      button.click();
      await new Promise(function (r) { setTimeout(r, 250); });
      var area = document.querySelector('.js-editor textarea');
      area.value = text;
      document.querySelector('.js-editor .js-save').click();
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    for (var i = 0; i < 6; i += 1) {
      await comment(plus[Math.min(i, plus.length - 1)], 'Comment number ' + (i + 1) + ' with a sentence long enough to wrap in the sidebar.');
    }
    // Resolve the first one the way the UI does.
    var edit = document.querySelector('.comment-box .js-resolve');
    if (edit) edit.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    PR.renderComments();
    return PR.state.comments.length;
  })()`);
  await new Promise((r) => setTimeout(r, 800));
  await record("desktop-1440", "many-comments");
  await shot("many-comments");

  // A comment whose line is later removed becomes outdated and orphaned.
  const outdated = await driver.executeScript(`(async function () {
    var section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('small.ts'));
    var box = section.querySelector('.comment-box');
    if (!box) return 'no comment';
    var path = section.dataset.path;
    // Pretend the working tree moved those lines: the server decides, so this
    // only checks how a comment already marked outdated is drawn.
    var comment = PR.state.comments.find(function (c) { return c.path === path; });
    if (!comment) return 'no comment on that path';
    comment.outdated = true;
    PR.renderComments();
    await new Promise(function (r) { setTimeout(r, 300); });
    return { path: path, sidebar: document.querySelectorAll('.is-outdated').length };
  })()`);
  await new Promise((r) => setTimeout(r, 500));
  results.push({ size: "desktop-1440", state: "outdated", outdated });
  await shot("outdated");

  // Split view on a narrow screen: the code column becomes very thin.
  for (const size of [{ name: "tablet-768", width: 768, height: 1024 }, { name: "phone-390", width: 390, height: 844 }]) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await waitReady();
    await driver.executeScript(`(function () {
      var select = document.getElementById('set-diff-mode');
      select.value = 'split';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 1800));
    await record(size.name, "split");
    await shot(`${size.name}-split`);
  }

  // The deferred large file placeholder, and the sidebar with many comments
  // at a phone width.
  await driver.manage().window().setRect({ width: 390, height: 844 });
  await driver.get(review.url);
  await waitReady();
  await record("phone-390", "deferred");
  await shot("phone-390-deferred");

  await driver.executeScript(`(async function () {
    var section = [...document.querySelectorAll('.diff-file')].find(function (s) { return s.querySelector('.line-plus'); });
    var plus = section.querySelectorAll('.line-plus[data-side="right"]');
    for (var i = 0; i < 5; i += 1) {
      plus[Math.min(i, plus.length - 1)].click();
      await new Promise(function (r) { setTimeout(r, 250); });
      var area = document.querySelector('.js-editor textarea');
      area.value = 'Comment ' + (i + 1) + ' with enough text to occupy two lines in a narrow sidebar.';
      document.querySelector('.js-editor .js-save').click();
      await new Promise(function (r) { setTimeout(r, 300); });
    }
    PR.renderComments();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 800));
  await driver.executeScript(`window.scrollTo(0, document.body.scrollHeight); return true;`);
  await new Promise((r) => setTimeout(r, 600));
  await record("phone-390", "comments-bottom");
  await shot("phone-390-comments");

  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await driver.quit();
  await review.page.close();
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {});
}
