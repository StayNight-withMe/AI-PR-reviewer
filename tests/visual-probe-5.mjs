
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
const OUT = "Z:\\system\\temp\\pr-review-visual-5";

const FILE = Array.from({ length: 20 }, (_, i) => `export const value${i + 1} = ${i + 1};`).join("\n") + "\n";

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-visual5-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), FILE);
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(root, "src", "a.ts"), FILE.replace("value5 = 5", "value5 = 55"));
  await git("add", "-A");
  await git("commit", "-m", "change");
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


const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEBAA4BAQH2g2MHAAAAAElFTkSuQmCC";

const MEASURE = `return (function () {
  var vw = window.innerWidth;
  var out = { viewport: vw + 'x' + window.innerHeight, offenders: [], overlaps: [], clipped: [], brokenImages: [] };
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
      out.offenders.push(String(el.className).slice(0, 36) + '#' + el.id + '@' + Math.round(b.right));
    }
    var st = getComputedStyle(el);
    if (el.children.length === 0 && (el.textContent || '').trim() &&
        st.overflow !== 'visible' && st.textOverflow !== 'ellipsis' &&
        el.scrollWidth > el.clientWidth + 2) {
      out.clipped.push(String(el.className).slice(0, 36) + ' [' + (el.textContent || '').trim().slice(0, 24) + ']');
    }
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) {
      out.brokenImages.push(String(el.className).slice(0, 30) + ' ' + (el.getAttribute('src') || '').slice(0, 40));
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
  piled(document.querySelector('.comment-head .comment-actions'), document.querySelector('.comment-body'), 'actions over body');
  var lightbox = document.querySelector('.lightbox.show');
  if (lightbox) {
    var img = lightbox.querySelector('img');
    var box = img ? img.getBoundingClientRect() : null;
    if (box && (box.width < 20 || box.height < 20)) out.clipped.push('lightbox image is tiny ' + Math.round(box.width) + 'x' + Math.round(box.height));
    if (box && (box.top < 0 || box.bottom > window.innerHeight)) out.clipped.push('lightbox image outside the window');
  }
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

try {
  for (const size of [
    { name: "desktop-1440", width: 1440, height: 900 },
    { name: "phone-390", width: 390, height: 844 },
  ]) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await waitReady();


    await driver.executeScript(`return (async function () {
      var section = document.querySelector('.diff-file');
      var plus = section.querySelector('.line-plus[data-side="right"]');
      plus.click();
      await new Promise(function (r) { setTimeout(r, 300); });
      var area = document.querySelector('.js-editor textarea');
      area.value = 'This screenshot shows the problem:';
      // The editor reads pasted images, so hand it one the same way.
      var editor = document.querySelector('.js-editor');
      var chips = editor.querySelector('.js-chips');
      var img = document.createElement('img');
      img.src = 'data:image/png;base64,${PNG}';
      var chip = document.createElement('span');
      chip.className = 'attach-chip';
      chip.appendChild(img);
      chips.appendChild(chip);
      editor.querySelector('.js-save').click();
      await new Promise(function (r) { setTimeout(r, 500); });
      PR.renderComments();
      return PR.state.comments.length;
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    results.push({ size: size.name, state: "comment-image", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-comment-image`);


    await driver.executeScript(`(function () {
      var chip = document.querySelector('.comment-attachments .attach-chip img');
      if (chip) chip.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    results.push({ size: size.name, state: "lightbox", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-lightbox`);
    await driver.executeScript(`PR.els.lightbox.classList.remove('show'); return true;`);
    await new Promise((r) => setTimeout(r, 300));


    const resolved = await driver.executeScript(`(async function () {
      var button = document.querySelector('.comment-box .js-resolve');
      if (!button) return { error: 'no resolve button' };
      button.click();
      await new Promise(function (r) { setTimeout(r, 600); });
      var box = document.querySelector('.comment-box');
      var item = document.querySelector('.comment-summary-item');
      var style = box ? getComputedStyle(box) : null;
      return {
        resolvedInState: PR.state.comments[0].resolved,
        boxClass: box ? box.className : null,
        boxOpacity: style ? style.opacity : null,
        summaryClass: item ? item.className : null,
        sidebarText: document.getElementById('comment-list').textContent.trim().slice(0, 40),
        counter: document.getElementById('comment-count').textContent,
      };
    })()`);
    await new Promise((r) => setTimeout(r, 500));
    results.push({ size: size.name, state: "resolved", resolved });
    await shot(`${size.name}-resolved`);


    await driver.executeScript(`document.getElementById('btn-submit').click(); return true;`);
    await new Promise((r) => setTimeout(r, 500));
    await driver.executeScript(`(function () {
      var wrap = document.getElementById('review-note-wrap');
      var chips = document.getElementById('review-note-chips');
      if (!wrap || !chips) return false;
      var img = document.createElement('img');
      img.src = 'data:image/png;base64,${PNG}';
      var chip = document.createElement('span');
      chip.className = 'attach-chip';
      chip.appendChild(img);
      chips.appendChild(chip);
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    results.push({ size: size.name, state: "note-attachment", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-note-attachment`);
  }

  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await driver.quit();
  await review.page.close();
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {});
}
