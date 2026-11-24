
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Builder, By } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);
const OUT = "Z:\\system\\temp\\pr-review-visual";


const WIDGET = [
  "namespace Shop {",
  "  public class Widget {",
  "    public int Id { get; set; }",
  "    private decimal _price;",
  "",
  "    public decimal Price {",
  "      get => _price;",
  "      set => _price = value;",
  "    }",
  "  }",
  "}",
  "",
].join("\r\n");

const CHECKOUT = [
  "export interface CartLine { sku: string; quantity: number; price: number }",
  "",
  "export class Checkout {",
  "\tprivate readonly lines: CartLine[] = [];",
  "",
  "\tadd(line: CartLine): this {",
  "\t\tif (line.quantity <= 0) throw new Error('A line must have a positive quantity, otherwise the totals are wrong');",
  "\t\tthis.lines.push(line);",
  "\t\treturn this;",
  "\t}",
  "",
  "\ttotal(): number {",
  "\t\treturn this.lines.reduce((sum, line) => sum + line.price * line.quantity, 0);",
  "\t}",
  "}",
  "",
].join("\n");

const LONG = Array.from({ length: 120 }, (_, index) => `const line${index + 1} = ${index + 1};`).join("\n") + "\n";
const longEdited = () => {
  const lines = LONG.trimEnd().split("\n");
  lines[59] = "const line60 = 600;";
  return `${lines.join("\n")}\n`;
};
const generated = (count) => Array.from({ length: count }, (_, index) => `export const value${index + 1} = ${index + 1};`).join("\n") + "\n";

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-visual-repo-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await writeFile(join(root, "README.md"), "# Widgets\n\nA small shop, used as the base commit of the review.\n");
  await writeFile(join(root, "docs-old.md"), "Old notes that the change removes.\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  await mkdir(join(root, "src", "widgets"), { recursive: true });
  await mkdir(join(root, "src", "checkout"), { recursive: true });
  await writeFile(join(root, "src", "widgets", "Widget.cs"), WIDGET);
  await writeFile(join(root, "src", "checkout", "Checkout.ts"), CHECKOUT);
  await writeFile(join(root, "src", "long.ts"), LONG);
  await writeFile(join(root, "src", "generated.ts"), generated(120));
  await git("add", "-A");
  await git("commit", "-m", "add the widget, checkout and long files");

  await writeFile(join(root, "src", "widgets", "Widget.cs"), WIDGET.replace("private decimal _price;", "private decimal _price;\r\n    private int _stock;"));
  await writeFile(join(root, "src", "long.ts"), longEdited());
  await writeFile(join(root, "src", "generated.ts"), generated(700));
  await rm(join(root, "docs-old.md"));
  await git("add", "-A");
  await git("commit", "-m", "track the widget stock and retune the long file");

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

const SIZES = [
  { name: "wide-1600", width: 1600, height: 1000 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "laptop-1280", width: 1280, height: 800 },
  { name: "small-1024", width: 1024, height: 768 },
  { name: "narrow-900", width: 900, height: 800 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "phone-390", width: 390, height: 844 },
];

const MEASURE = `return (function () {
  var vw = window.innerWidth;
  var doc = document.documentElement;
  var out = {
    viewport: vw + 'x' + window.innerHeight,
    horizontalScroll: doc.scrollWidth - vw,
    headerHeight: Math.round(document.querySelector('.gh-header').getBoundingClientRect().height),
    tabsTop: Math.round(document.querySelector('.gh-tabs').getBoundingClientRect().top),
    offenders: [],
    clippedText: [],
    overlaps: [],
  };
  var skipOverflow = function (el) {
    // Elements that are meant to scroll sideways on their own.
    var style = getComputedStyle(el);
    return style.overflowX === 'auto' || style.overflowX === 'scroll';
  };
  var scrollsAnywhere = function (el) {
    for (var p = el.parentElement; p; p = p.parentElement) if (skipOverflow(p)) return true;
    return false;
  };
  var nodes = document.querySelectorAll('body *');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.getClientRects().length === 0) continue;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right > vw + 1 && !skipOverflow(el) && !scrollsAnywhere(el)) {
      out.offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 60),
        id: el.id,
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
    // Text wider than its box, cut off without an ellipsis: the reader loses content.
    var style2 = getComputedStyle(el);
    if (el.children.length === 0 && (el.textContent || '').trim() &&
        style2.overflow !== 'visible' && style2.textOverflow !== 'ellipsis' &&
        el.scrollWidth > el.clientWidth + 2) {
      out.clippedText.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 50),
        id: el.id,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
  }
  /** Elements of one row must not sit on top of each other. */
  var piled = function (a, b, label) {
    if (!a || !b) return;
    var ra = a.getBoundingClientRect();
    var rb = b.getBoundingClientRect();
    if (ra.width === 0 || rb.width === 0) return;
    var overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
    var overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (overlapX > 1 && overlapY > 1) {
      out.overlaps.push({
        what: label,
        x: Math.round(overlapX),
        y: Math.round(overlapY),
        a: (a.textContent || '').trim().slice(0, 30),
        b: (b.textContent || '').trim().slice(0, 30),
      });
    }
  };
  var header = document.querySelector('.gh-header');
  var tabs = document.querySelector('.gh-tabs');
  piled(header, tabs, 'tabs over header');
  var headers = document.querySelectorAll('.diff-file-header');
  for (var f = 0; f < headers.length && f < 4; f++) {
    var head = headers[f];
    piled(head.querySelector('.path'), head.querySelector('.file-stats'), 'path over stats');
    piled(head.querySelector('.path'), head.querySelector('.viewed-wrap'), 'path over viewed');
    piled(head.querySelector('.file-stats'), head.querySelector('.viewed-wrap'), 'stats over viewed');
    // A sticky header must not sit under the sticky page chrome.
    if (f === 0) {
      var hb = head.getBoundingClientRect();
      var tb = tabs.getBoundingClientRect();
      if (hb.top < tb.bottom - 1 && hb.bottom > tb.bottom + 1) {
        out.overlaps.push({ what: 'first file header under tabs', x: 0,
          y: Math.round(tb.bottom - hb.top), a: '', b: '' });
      }
    }
  }
  return out;
})()`;

const results = [];
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless"))
  .build();

try {
  for (const size of SIZES) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await driver.wait(async () => {
      try {
        return await driver.executeScript(`return document.body.dataset.booted === '1' &&
          [...document.querySelectorAll('.diff-file')].every(s => s.dataset.hydrated === '1')`);
      } catch { return false; }
    }, 60000);
    await new Promise((r) => setTimeout(r, 1500));

    const measured = await driver.executeScript(MEASURE);
    results.push({ size: size.name, ...measured });

    const png = await driver.takeScreenshot();
    await writeFile(join(OUT, `${size.name}.png`), png, "base64");


    const headerShot = await driver.takeScreenshot();
    void headerShot;
  }


  await driver.manage().window().setRect({ width: 1440, height: 900 });
  await driver.get(review.url);
  await driver.wait(async () => {
    try {
      return await driver.executeScript(`return document.body.dataset.booted === '1'`);
    } catch { return false; }
  }, 60000);
  await new Promise((r) => setTimeout(r, 2000));

  async function shot(name, prepare) {
    if (prepare) {
      await driver.executeScript(prepare);
      await new Promise((r) => setTimeout(r, 900));
    }
    await writeFile(join(OUT, `${name}.png`), await driver.takeScreenshot(), "base64");
  }

  await shot("state-settings", `document.getElementById('btn-settings').click(); return true;`);
  await shot("state-close-settings", `document.getElementById('btn-settings').click(); return true;`);
  await shot("state-comment", `(function(){
    var section = document.querySelector('.diff-file');
    var button = section.querySelector('.js-comment[data-side="right"]');
    if (button) button.click();
    return true;
  })()`);
  await shot("state-submit", `document.getElementById('btn-submit').click(); return true;`);
  await shot("state-close-submit", `(function(){
    var cancel = document.getElementById('dispatch-cancel') ||
      [...document.querySelectorAll('#dispatch-modal button')].find(b => b.textContent.trim() === 'Cancel');
    if (cancel) cancel.click();
    return true;
  })()`);
  await shot("state-search", `document.getElementById('btn-search').click(); return true;`);
  await shot("state-close-search", `(function(){
    var button = document.getElementById('btn-search');
    if (button.getAttribute('aria-expanded') === 'true') button.click();
    return true;
  })()`);
  await shot("state-split", `(function(){
    var select = document.getElementById('set-diff-mode');
    select.value = 'split';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await shot("state-back-to-unified", `(function(){
    var select = document.getElementById('set-diff-mode');
    select.value = 'unified';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);


  for (const size of SIZES.filter((s) => s.width <= 768)) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await driver.wait(async () => {
      try {
        return await driver.executeScript(`return document.body.dataset.booted === '1'`);
      } catch { return false; }
    }, 60000);
    await new Promise((r) => setTimeout(r, 1200));
    async function narrowShot(name, prepare) {
      await driver.executeScript(prepare);
      await new Promise((r) => setTimeout(r, 700));
      await writeFile(join(OUT, `${size.name}-${name}.png`), await driver.takeScreenshot(), "base64");
      const layout = await driver.executeScript(MEASURE);
      results.push({ size: `${size.name}-${name}`, ...layout });
    }
    await narrowShot("submit", `document.getElementById('btn-submit').click(); return true;`);
    await narrowShot("close-submit", `(function(){
      var cancel = [...document.querySelectorAll('#dispatch-modal button')]
        .find(b => b.textContent.trim() === 'Cancel');
      if (cancel) cancel.click();
      return true;
    })()`);
    await narrowShot("settings", `document.getElementById('btn-settings').click(); return true;`);
    await narrowShot("close-settings", `document.getElementById('btn-settings').click(); return true;`);
    await narrowShot("search", `document.getElementById('btn-search').click(); return true;`);
    await narrowShot("comment", `(function(){
      var section = document.querySelector('.diff-file');
      var button = section.querySelector('.js-comment[data-side="right"]');
      if (button) button.click();
      return true;
    })()`);
  }
} finally {
  await driver.quit();
  await review.page.close();
}

console.log(JSON.stringify(results, null, 2));
await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
console.log("\nfiles:", (await readdir(OUT)).join(", "));
void By;
