/**
 * Second visual probe: the states the first one did not touch — comments on the
 * page, a long path, deep tree nesting, the comment picker, the light theme at a
 * narrow width, and the position a file lands at after a jump from the tree.
 *
 * Run: node tests/visual-probe-2.mjs
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
const OUT = "Z:\\system\\temp\\pr-review-visual-2";

const LONG_PATH = [
  "src", "services", "AtlasService", "Atlas.Application",
  "Features", "Activation", "SubmitPhoneHandlerWithAVeryLongName.cs",
];

const HANDLER = [
  "namespace Atlas.Application.Features.Activation;",
  "",
  "public sealed class SubmitPhoneHandlerWithAVeryLongName",
  "{",
  "    private readonly IPhoneSender _sender;",
  "",
  "    public SubmitPhoneHandlerWithAVeryLongName(IPhoneSender sender)",
  "    {",
  "        _sender = sender;",
  "    }",
  "",
  "    public async Task HandleAsync(SubmitPhoneCommand command)",
  "    {",
  "        await _sender.SendAsync(command.Phone, \"Your confirmation code is 1234, please do not share it\");",
  "    }",
  "}",
  "",
].join("\n");

const DEEP = [
  "namespace Deep;",
  "",
  "public static class Constants",
  "{",
  "    public const string Everything = \"a value long enough to need wrapping in a narrow diff pane\";",
  "}",
  "",
].join("\n");

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-visual2-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await writeFile(join(root, "README.md"), "# Shop\n\nBase commit.\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  const deepDir = join(root, ...LONG_PATH.slice(0, -1));
  const nestedDir = join(root, "src", "a", "b", "c", "d", "e", "f");
  await mkdir(deepDir, { recursive: true });
  await mkdir(nestedDir, { recursive: true });
  await writeFile(join(root, ...LONG_PATH), HANDLER);
  await writeFile(join(nestedDir, "Deep.cs"), DEEP);
  await git("add", "-A");
  await git("commit", "-m", "add the handler and a deeply nested file");

  await writeFile(join(root, ...LONG_PATH), HANDLER.replace(
    "    public async Task HandleAsync(SubmitPhoneCommand command)",
    "    public async Task HandleAsync(SubmitPhoneCommand command, CancellationToken token)",
  ));
  await writeFile(join(nestedDir, "Deep.cs"), DEEP.replace("a value", "another value"));
  await git("add", "-A");
  await git("commit", "-m", "pass a cancellation token");

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
  var out = { viewport: vw + 'x' + window.innerHeight, offenders: [], overlaps: [], clipped: [], lowContrast: [] };

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
  });

  /** Elements that must not sit on top of each other. */
  var piled = function (a, b, label) {
    if (!a || !b) return;
    var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return;
    var x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    var y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (x > 1 && y > 1) {
      out.overlaps.push(label + ' (' + Math.round(x) + 'x' + Math.round(y) + ')');
    }
  };
  var header = document.querySelector('.gh-header');
  document.querySelectorAll('.gh-header .gh-btn, .gh-header .search-wrap, .gh-header .header-summary').forEach(function (el) {
    if (el.closest('.search-panel')) return;
    piled(header.querySelector('.header-info'), el, 'header info over ' + (el.id || el.className.slice(0, 20)));
  });

  /** The dialog must stay inside the window on every side. */
  var modal = document.querySelector('.modal-backdrop.show .modal');
  if (modal) {
    var mb = modal.getBoundingClientRect();
    if (mb.top < 0) out.offenders.push('modal above the window top ' + Math.round(mb.top));
    if (mb.bottom > window.innerHeight + 1) out.offenders.push('modal below the window ' + Math.round(mb.bottom));
    if (mb.left < 0 || mb.right > vw + 1) out.offenders.push('modal sideways ' + Math.round(mb.left) + '..' + Math.round(mb.right));
  }

  /** Text that cannot be read against its own background. */
  var parse = function (color) {
    var m = /rgba?\\(([^)]+)\\)/.exec(color);
    if (!m) return null;
    var parts = m[1].split(',').map(function (v) { return parseFloat(v); });
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  /** Composites a possibly translucent colour over an opaque one. */
  var over = function (top, bottom) {
    var a = top.a;
    return {
      r: top.r * a + bottom.r * (1 - a),
      g: top.g * a + bottom.g * (1 - a),
      b: top.b * a + bottom.b * (1 - a),
      a: 1,
    };
  };
  var luminance = function (c) {
    var channel = function (v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  };
  /** The colour a viewer actually sees behind an element, translucency resolved. */
  var effectiveBackground = function (el) {
    var layers = [];
    for (var n = el; n; n = n.parentElement) {
      var c = parse(getComputedStyle(n).backgroundColor);
      if (!c || c.a === 0) continue;
      layers.push(c);
      if (c.a === 1) break;
    }
    var base = { r: 13, g: 17, b: 23, a: 1 };
    if (document.documentElement.getAttribute('data-theme') === 'light') base = { r: 255, g: 255, b: 255, a: 1 };
    var result = base;
    for (var i = layers.length - 1; i >= 0; i -= 1) result = over(layers[i], result);
    return result;
  };
  var fgColour = function (el) {
    var c = parse(getComputedStyle(el).color);
    if (!c) return null;
    if (c.a === 1) return c;
    return over(c, effectiveBackground(el));
  };
  document.querySelectorAll('.small.muted, .muted, .diff-num, .diff-code, .tree-label, .status, .search-hit-text').forEach(function (el) {
    if (el.getClientRects().length === 0 || el.children.length) return;
    if (!(el.textContent || '').trim()) return;
    var fg = fgColour(el);
    if (!fg) return;
    var bg = effectiveBackground(el);
    var lf = luminance(fg);
    var lb = luminance(bg);
    var ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    if (ratio < 2.2) {
      out.lowContrast.push(String(el.className).slice(0, 30) + ' ' + ratio.toFixed(2) + ' [' +
        (el.textContent || '').trim().slice(0, 20) + ']');
    }
  });

  return out;
})()`;

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless"))
  .build();

const results = [];
const shot = async (name) => {
  await writeFile(join(OUT, `${name}.png`), await driver.takeScreenshot(), "base64");
};
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
    { name: "wide-1600", width: 1600, height: 1000 },
    { name: "desktop-1440", width: 1440, height: 900 },
    { name: "small-1024", width: 1024, height: 768 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "phone-390", width: 390, height: 844 },
  ]) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await waitReady();
    results.push({ size: size.name, state: "base", ...(await driver.executeScript(MEASURE)) });
    await shot(size.name);
  }

  // Comments on the page: a line comment, a file comment, and a note image.
  await driver.manage().window().setRect({ width: 1440, height: 900 });
  await driver.get(review.url);
  await waitReady();

  const withComments = await driver.executeScript(`(async function () {
    var section = document.querySelector('.diff-file');
    var path = section.dataset.path;
    var plus = section.querySelector('.line-plus[data-side="right"]');
    plus.click();
    await new Promise(function (r) { setTimeout(r, 300); });
    var area = document.querySelector('.js-editor textarea');
    area.value = 'A comment with enough text to wrap over more than one line in the sidebar, which is the narrowest place it appears.';
    document.querySelector('.js-editor .js-save').click();
    await new Promise(function (r) { setTimeout(r, 400); });
    PR.renderComments();
    return { path: path };
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot("state-comments");
  results.push({ size: "desktop-1440", state: "comments", ...(await driver.executeScript(MEASURE)) });

  // The same page with a file header whose path is long enough to be cut.
  const longPathRow = await driver.executeScript(`return (function () {
    var headers = [...document.querySelectorAll('.diff-file-header')];
    var target = headers.map(function (h) { return h.querySelector('.path'); })
      .sort(function (a, b) { return b.scrollWidth - a.scrollWidth; })[0];
    return target ? { text: target.textContent, width: Math.round(target.getBoundingClientRect().width),
      scrollWidth: target.scrollWidth } : null;
  })()`);
  results.push({ size: "desktop-1440", state: "long-path", longPath: longPathRow });

  // Jump from the tree must not land the file under the sticky chrome.
  const landing = await driver.executeScript(`return (async function () {
    var row = [...document.querySelectorAll('.tree-row[data-dir="false"]')].pop();
    row.click();
    await new Promise(function (r) { setTimeout(r, 1600); });
    var section = PR.findSection(row.dataset.path);
    if (!section) return { error: 'no section' };
    var header = section.querySelector('.diff-file-header').getBoundingClientRect();
    var tabs = document.querySelector('.gh-tabs').getBoundingClientRect();
    var toolbar = document.querySelector('.gh-sticky-toolbar').getBoundingClientRect();
    return {
      path: row.dataset.path,
      headerTop: Math.round(header.top),
      chromeBottom: Math.round(Math.max(tabs.bottom, toolbar.bottom)),
      covered: header.top < Math.max(tabs.bottom, toolbar.bottom) - 1 && header.bottom > tabs.bottom,
    };
  })()`);
  results.push({ size: "desktop-1440", state: "tree-jump", landing });
  await shot("state-tree-jump");

  // The commit picker at a narrow width.
  for (const size of [{ name: "tablet-768", width: 768, height: 1024 }, { name: "phone-390", width: 390, height: 844 }]) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await waitReady();
    await driver.executeScript(`document.querySelector('.gh-tab[data-tab="commits"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 900));
    await driver.executeScript(`(function () {
      var mode = document.getElementById('scope-mode');
      mode.value = 'range';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 900));
    results.push({ size: size.name, state: "commit-picker", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-commit-picker`);
  }

  // Light theme at a phone width: colours were only checked on a wide screen.
  await driver.manage().window().setRect({ width: 390, height: 844 });
  await driver.get(review.url);
  await waitReady();
  await driver.executeScript(`document.getElementById('btn-theme').click(); return true;`);
  await new Promise((r) => setTimeout(r, 700));
  results.push({ size: "phone-390", state: "light", ...(await driver.executeScript(MEASURE)) });
  await shot("phone-390-light");

  await driver.executeScript(`document.getElementById('btn-settings').click(); return true;`);
  await new Promise((r) => setTimeout(r, 500));
  await shot("phone-390-light-settings");

  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await driver.quit();
  await review.page.close();
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {});
}
