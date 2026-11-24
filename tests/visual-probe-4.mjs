
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
const OUT = "Z:\\system\\temp\\pr-review-visual-4";



const DEEP = Array.from({ length: 6 }, (_, i) => `folder-${i + 1}-with-a-long-name`);
const FILE_NAME = "AVeryLongClassNameThatKeepsGoingAndThenSomeMore.cs";

async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-visual4-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  await git("init", "--initial-branch", "feature/a-branch-with-a-very-long-name-indeed");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "a commit whose subject is long enough to be cut off in a narrow list, which it usually is");

  const dir = join(root, ...DEEP);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FILE_NAME), "class A {}\n");
  await git("add", "-A");
  await git("commit", "-m", "add a very deeply nested file");

  await writeFile(join(dir, FILE_NAME), "class A { int Value; }\n");
  await git("add", "-A");
  await git("commit", "-m", "give it a value");

  return { root, git, file: [...DEEP, FILE_NAME].join("/") };
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
  var out = { viewport: vw + 'x' + window.innerHeight, offenders: [], overlaps: [], clipped: [] };
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
      out.clipped.push(String(el.className).slice(0, 40) + ' [' + (el.textContent || '').trim().slice(0, 26) + ']');
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
  var head = document.querySelector('.diff-file-header');
  if (head) {
    piled(head.querySelector('.path'), head.querySelector('.file-stats'), 'path over stats');
    piled(head.querySelector('.file-stats'), head.querySelector('.viewed-wrap'), 'stats over viewed');
    piled(head.querySelector('.viewed-wrap'), head.querySelector('.file-menu'), 'viewed over menu');
  }
  var toast = document.getElementById('toast');
  if (toast && toast.classList.contains('show')) {
    piled(toast, document.querySelector('.action-bar'), 'toast over action bar');
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
    { name: "small-1024", width: 1024, height: 768 },
    { name: "tablet-768", width: 768, height: 1024 },
    { name: "phone-390", width: 390, height: 844 },
  ]) {
    await driver.manage().window().setRect({ width: size.width, height: size.height });
    await driver.get(review.url);
    await waitReady();


    await driver.executeScript(`(function () {
      PR.state.tab = PR.TAB.FILES;
      PR.syncTabs();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));

    results.push({ size: size.name, state: "long-path", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-long-path`);


    await driver.executeScript(`PR.toast('A message that is long enough to need wrapping across the bottom of a narrow window, twice over', false); return true;`);
    await new Promise((r) => setTimeout(r, 400));
    results.push({ size: size.name, state: "toast", ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-toast`);


    await driver.executeScript(`document.querySelector('.gh-tab[data-tab="commits"]').click(); return true;`);
    await new Promise((r) => setTimeout(r, 800));
    const commit = await driver.executeScript(`return (function () {
      var subject = document.querySelector('.commit-subject');
      if (!subject) return null;
      var b = subject.getBoundingClientRect();
      return { width: Math.round(b.width), text: subject.textContent.trim().slice(0, 40),
        overflow: getComputedStyle(subject).overflow,
        clipped: subject.scrollWidth > subject.clientWidth + 2,
        wraps: b.height > 26 };
    })()`);
    results.push({ size: size.name, state: "commits", commit, ...(await driver.executeScript(MEASURE)) });
    await shot(`${size.name}-commits`);
  }

  console.log(JSON.stringify(results, null, 2));
  await writeFile(join(OUT, "results.json"), JSON.stringify(results, null, 2));
} finally {
  await driver.quit();
  await review.page.close();
  await rm(fixture.root, { recursive: true, force: true }).catch(() => {});
}
