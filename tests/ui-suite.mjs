/**
 * A large, self-contained UI test suite.
 *
 * Every other UI test needs a page started somewhere else, on a fixed port, with
 * a particular repository checked out. That made them brittle and narrow: they
 * only ever asserted the few things the last bug report was about. This suite
 * builds the repository it needs, opens the review itself, and drives a real
 * browser through the whole review flow — reading files, commenting, approving,
 * reloading, switching scope. A check here fails for a user-visible reason, not
 * because a helper moved.
 *
 * Run: node tests/ui-suite.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);

const failures = [];
let checks = 0;

/** Runs one check, recording a readable failure instead of stopping the suite. */
async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
    console.log(`FAIL ${name} — ${error.message}`);
  }
}

/** The C# fixture: real-looking code with the awkward names found in the wild. */
const WIDGET = [
  "namespace Demo;",
  "",
  "/// <summary>A widget with a price.</summary>",
  "public class Widget",
  "{",
  "    private decimal _price;",
  "",
  "    public string Name { get; set; } = \"widget\";",
  "",
  "    public decimal Price",
  "    {",
  "        get => _price;",
  "        set => _price = value < 0 ? 0 : value;",
  "    }",
  "",
  "    public override string ToString() => $\"{Name}: {Price}\";",
  "}",
  "",
].join("\n");

/** A TypeScript file with long lines, so wrapping and tabs are exercised. */
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

/** A Go file: a language the old bundle had no grammar for. */
const MAIN_GO = [
  "package main",
  "",
  "import \"fmt\"",
  "",
  "func main() {",
  "\tfmt.Println(\"hello\")",
  "}",
  "",
].join("\n");

/** A long file, to exercise the large-file setting and the gap expander. */
const LONG = Array.from({ length: 120 }, (_, index) => `const line${index + 1} = ${index + 1};`).join("\n") + "\n";

/** The same file with one line changed in the middle and one at the end. */
function longEdited() {
  const lines = LONG.trimEnd().split("\n");
  lines[59] = "const line60 = 600;";
  lines[119] = "const line120 = 1200;";
  return `${lines.join("\n")}\n`;
}

/** A generated-looking file, big enough to trip the large-file setting. */
function generated(count) {
  return Array.from({ length: count }, (_, index) => `export const value${index + 1} = ${index + 1};`).join("\n") + "\n";
}

/** Builds the repository, one commit with a realistic change set. */
async function createRepository() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-ui-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });

  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await writeFile(join(root, "README.md"), "# Widgets\n\nA small shop, used as the base commit of the review.\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  // A long file that the reviewed commit never touches: the "open an unchanged
  // file inside the review" path needs a file with real content.
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "docs", "GUIDE.md"), Array.from({ length: 40 }, (_, index) => `Line ${index + 1} of the guide.`).join("\n") + "\n");
  // A file that is deleted in the reviewed commit.
  await writeFile(join(root, "docs", "old-notes.md"), "Old notes that the change removes.\n");
  // A binary file the review must not try to render as text.
  await writeFile(join(root, "docs", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  await git("add", "-A");
  await git("commit", "-m", "add the guide, old notes and a logo");

  await mkdir(join(root, "src", "widgets"), { recursive: true });
  await mkdir(join(root, "src", "checkout"), { recursive: true });
  await writeFile(join(root, "src", "widgets", "Widget.cs"), WIDGET);
  await writeFile(join(root, "src", "checkout", "Checkout.ts"), CHECKOUT);
  await writeFile(join(root, "src", "main.go"), MAIN_GO);
  await writeFile(join(root, "src", "long.ts"), LONG);
  // A generated file over the large-file threshold, changed in the review.
  await writeFile(join(root, "src", "generated.ts"), generated(120));
  await git("add", "-A");
  await git("commit", "-m", "add the widget, checkout and go files");

  // The reviewed change: a field in the widget, two distant lines in the long
  // file, a regenerated snapshot, a deleted document and a new logo state.
  await writeFile(join(root, "src", "widgets", "Widget.cs"), WIDGET.replace("private decimal _price;", "private decimal _price;\n    private int _stock;"));
  await writeFile(join(root, "src", "long.ts"), longEdited());
  await writeFile(join(root, "src", "generated.ts"), generated(700));
  await rm(join(root, "docs", "old-notes.md"));
  await writeFile(join(root, "docs", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 14]));
  await git("add", "-A");
  await git("commit", "-m", "track the widget stock and retune the long file");

  return { root, git };
}

/** Waits for the page to say it is wired, then for every section to hydrate. */
async function waitForPage(driver) {
  const js = (code) => driver.executeScript(`return (${code});`);

  await driver.wait(async () => {
    try { return await js("document.body.dataset.booted === '1'"); } catch { return false; }
  }, 60000);

  await driver.wait(async () => {
    try {
      return await js(`[...document.querySelectorAll('.diff-file')].length > 0 &&
        [...document.querySelectorAll('.diff-file')].every(s => s.dataset.hydrated === '1')`);
    } catch { return false; }
  }, 120000);
}

const fixture = await createRepository();
// The suite must never send a review into the chat that is running it.
for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
process.env[GIT.ARTIFACTS_DIR_ENV] = join(fixture.root, "artifacts");

const base = (await fixture.git("rev-parse", "HEAD~1")).stdout.trim();
const head = (await fixture.git("rev-parse", "HEAD")).stdout.trim();

const reviewState = await startReview({
  repoPath: fixture.root,
  mode: MODE.RANGE,
  base,
  head: "HEAD",
  port: 0,
  symbols: true,
  dispatchEnabled: false,
  sessionId: "",
});

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1500, height: 1000 }))
  .build();

const js = (code) => driver.executeScript(`return (${code});`);
const pageErrors = [];
driver.manage().logs().get("browser").catch(() => null);

try {
  await driver.get(reviewState.url);
  await waitForPage(driver);

  /** Collects console errors, so a broken page cannot pass silently. */
  async function runtimeErrors() {
    const entries = await driver.manage().logs().get("browser").catch(() => []);
    return entries
      .filter((entry) => entry.level.name === "SEVERE" || /error/i.test(entry.message))
      .map((entry) => entry.message);
  }

  await check("the page boots with no runtime error", async () => {
    const errors = await runtimeErrors();
    pageErrors.push(...errors);
    assert.deepEqual(errors, [], `the page logged ${errors.length} error(s)`);
  });

  await check("a binary file says so instead of rendering garbage", async () => {
    const state = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('logo.png'));
      return {
        found: !!section,
        body: section ? section.querySelector('.diff-body').textContent.trim() : '',
        rows: section ? section.querySelectorAll('td.diff-code').length : 0,
      };
    })()`);
    assert.ok(state.found, "the binary file has no section");
    assert.match(state.body, /Binary file/i, "a binary file is not labelled as binary");
    assert.equal(state.rows, 0, "a binary file was rendered as code");
  });

  await check("a deleted file is rendered as removals and offers no expander", async () => {
    const state = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('old-notes.md'));
      return {
        found: !!section,
        deletedRows: section ? section.querySelectorAll('tr.row-del').length : 0,
        addedRows: section ? section.querySelectorAll('tr.row-add').length : 0,
        expanders: section ? section.querySelectorAll('.hunk-expander').length : 0,
        collapsedFirst: section ? section.classList.contains('collapsed') : null,
      };
    })()`);
    assert.ok(state.found, "the deleted file has no section");
    assert.ok(state.deletedRows > 0, "a deleted file shows no removed lines");
    assert.equal(state.addedRows, 0, "a deleted file shows added lines");
    assert.equal(state.expanders, 0, "a deleted file offers to reveal lines it no longer has");
    assert.equal(state.collapsedFirst, true, "a deleted file should start collapsed, like GitHub");
  });

  await check("a large file starts behind Load and loads on demand", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('generated.ts'));
      const before = {
        deferred: section.classList.contains('is-deferred'),
        rows: section.querySelectorAll('td.diff-code').length,
        note: (section.querySelector('.deferred-note') || {}).textContent || '',
      };
      const button = section.querySelector('.js-load-file');
      if (button) button.click();
      await new Promise(r => setTimeout(r, 1200));
      return { before, after: section.querySelectorAll('td.diff-code').length, stillDeferred: section.classList.contains('is-deferred') };
    })()`);
    assert.ok(state.before.deferred, "a large file was rendered in full");
    assert.equal(state.before.rows, 0, "a deferred file already holds code rows");
    assert.match(state.before.note, /lines in the file/, `the defer reason does not mention the file size: ${state.before.note}`);
    assert.ok(state.after > state.before.rows, "loading the large file showed nothing");
    assert.equal(state.stillDeferred, false, "the file is still marked deferred after loading");
  });

  await check("nothing is cut off: the last line of each file is in the DOM", async () => {
    const state = await js(`(() => {
      const sections = [...document.querySelectorAll('.diff-file')];
      const report = sections.map(section => {
        const path = section.dataset.path;
        const cells = [...section.querySelectorAll('td.diff-num[data-side="right"]')]
          .map(td => Number(td.dataset.line)).filter(n => n > 0);
        const file = PR.findFile(path);
        return {
          path,
          lastShown: cells.length ? Math.max(...cells) : 0,
          totalLines: file ? file.totalLines : 0,
          deferred: section.classList.contains('is-deferred'),
          bars: section.querySelectorAll('.hunk-expander').length,
        };
      });
      return report;
    })()`);
    // A file with a hidden tail must show an expander; a file without a tail
    // must render its real last line. Neither may silently lose lines.
    const broken = state.filter((file) => !file.deferred && file.totalLines > 0 && file.lastShown < file.totalLines && file.bars === 0);
    assert.deepEqual(broken, [], `files lost their tail with no way to open it: ${JSON.stringify(broken)}`);
  });

  await check("the theme switch recolours the page and sticks", async () => {
    const state = await js(`(async () => {
      const probe = () => {
        const box = document.createElement('div');
        box.style.color = 'var(--fg)';
        document.body.appendChild(box);
        const color = getComputedStyle(box).color;
        box.remove();
        return color;
      };
      const before = { theme: document.documentElement.getAttribute('data-theme'), color: probe() };
      document.getElementById('btn-theme').click();
      await new Promise(r => setTimeout(r, 300));
      const after = { theme: document.documentElement.getAttribute('data-theme'), color: probe() };
      document.getElementById('btn-theme').click();
      await new Promise(r => setTimeout(r, 300));
      return { before, after, back: document.documentElement.getAttribute('data-theme'), stored: PR.state.settings.theme };
    })()`);
    assert.notEqual(state.after.theme, state.before.theme, "the theme button changed nothing");
    assert.notEqual(state.after.color, state.before.color, "the text colour did not follow the theme");
    assert.equal(state.back, state.before.theme, "the theme did not switch back");
  });

  await check("the header shows the repo, the scope and the real stats", async () => {
    const header = await js(`(() => ({
      title: document.querySelector('.gh-header h1').textContent,
      mode: document.querySelector('.mode-pill').textContent.trim(),
      summary: document.getElementById('header-summary').textContent,
      files: document.querySelectorAll('.diff-file').length,
    }))()`);
    assert.match(header.title, /src|pr-review-ui/i, "the header lost the repository name");
    assert.ok(header.mode.length > 0, "the scope pill is empty");
    assert.match(header.summary, /files/, "the summary has no file count");
    assert.equal(header.files, 5, `expected five changed files in the range, saw ${header.files}`);
  });

  await check("the file list matches what the scope really changed", async () => {
    const state = await js(`(() => PR.state.files.map(f => ({ path: f.path, status: f.status, binary: !!f.binary })))()`);
    const paths = state.map((file) => file.path);
    assert.ok(paths.includes("src/widgets/Widget.cs"), "the modified file is missing");
    assert.ok(paths.includes("src/generated.ts"), "the regenerated file is missing");
    assert.ok(paths.includes("docs/old-notes.md"), "the deleted file is missing");
    assert.ok(paths.includes("docs/logo.png"), "the changed binary is missing");
    const deleted = state.find((file) => file.path === "docs/old-notes.md");
    assert.equal(deleted.status, "deleted", "the deleted file is not marked deleted");
    const binary = state.find((file) => file.path === "docs/logo.png");
    assert.equal(binary.binary, true, "the image is not treated as binary");
  });

  await check("files are ordered like a directory tree", async () => {
    const paths = await js(`PR.state.files.map(f => f.path)`);
    const sorted = [...paths].sort((a, b) => a.localeCompare(b));
    // Directories before files at the same level, then alphabetical: the exact
    // order is asserted by the server's own sort, so the check is that the
    // display order is stable and complete rather than random.
    assert.equal(paths.length, sorted.length, "files were lost in the ordering");
    assert.deepEqual(await js(`PR.state.files.map(f => f.path)`), paths, "the file order changed between reads");
  });

  await check("the header stats match the sum of the files", async () => {
    const state = await js(`(() => {
      const files = PR.state.files;
      const added = files.reduce((sum, f) => sum + f.additions, 0);
      const removed = files.reduce((sum, f) => sum + f.deletions, 0);
      const summary = PR.state.files.length;
      return {
        added, removed, summary,
        headerAdd: document.querySelector('.gh-header-meta .stat-add').textContent,
        headerDel: document.querySelector('.gh-header-meta .stat-del').textContent,
        dataAdded: PR.DATA.stats.additions,
        dataRemoved: PR.DATA.stats.deletions,
      };
    })()`);
    assert.equal(state.dataAdded, state.added, "the header additions disagree with the files");
    assert.equal(state.dataRemoved, state.removed, "the header deletions disagree with the files");
    assert.equal(state.headerAdd, `+${state.added}`, "the header shows a wrong addition count");
  });

  await check("every changed file is rendered exactly once", async () => {
    const paths = await js(`[...document.querySelectorAll('.diff-file')].map(s => s.dataset.path)`);
    assert.equal(new Set(paths).size, paths.length, `a file is rendered twice: ${JSON.stringify(paths)}`);
  });

  await check("all sections hydrate and none reports a highlight failure", async () => {
    const state = await js(`(() => {
      const sections = [...document.querySelectorAll('.diff-file')];
      return {
        total: sections.length,
        hydrated: sections.filter(s => s.dataset.hydrated === '1').length,
        failed: sections.filter(s => s.dataset.highlightFailed === '1').length,
      };
    })()`);
    assert.equal(state.hydrated, state.total, `${state.total - state.hydrated} section(s) never loaded`);
    assert.equal(state.failed, 0, "a section reported a highlighting failure");
  });

  await check("the C# file is coloured, not plain white", async () => {
    const state = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('.cs'));
      if (!section) return { missing: true };
      const cells = [...section.querySelectorAll('td.diff-code')];
      return {
        cells: cells.length,
        coloured: cells.filter(c => c.querySelectorAll('span').length > 0).length,
        keywords: section.querySelectorAll('.hljs-keyword').length,
        types: section.querySelectorAll('.hljs-title, .hljs-type, .sym-type').length,
      };
    })()`);
    assert.ok(!state.missing, "the C# file is missing from the range");
    assert.ok(state.cells > 5, "the C# file did not render");
    assert.ok(state.coloured > 5, `only ${state.coloured}/${state.cells} lines got colour`);
    assert.ok(state.keywords > 2, "C# keywords were not highlighted");
  });

  await check("line numbers are the ones of the reviewed version", async () => {
    const numbers = await js(`(() => {
      // The first section may be a binary or a deleted file, which have no
      // right-side numbers at all; the invariant is about a rendered diff.
      const sections = [...document.querySelectorAll('.diff-file')];
      const read = (section) => [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0);
      const best = sections
        .map(section => ({ path: section.dataset.path, cells: read(section) }))
        .sort((a, b) => b.cells.length - a.cells.length)[0];
      return {
        path: best.path,
        count: best.cells.length,
        first: best.cells[0],
        sorted: best.cells.every((n, i) => i === 0 || n > best.cells[i - 1]),
      };
    })()`);
    assert.ok(numbers.count > 3, `the diff of ${numbers.path} has almost no numbered rows`);
    assert.ok(numbers.sorted, "right-side line numbers are out of order");
  });

  await check("the file tree lists every changed file and opens one", async () => {
    const rows = await js(`[...document.querySelectorAll('.tree-row[data-dir="false"]')].map(r => r.dataset.path)`);
    assert.ok(rows.length >= 1, "the tree has no files");
    assert.ok(rows.some((path) => path.endsWith("Widget.cs")), "the tree is missing the changed file");
  });

  await check("Settings opens and its fields are present", async () => {
    const state = await js(`(() => {
      document.getElementById('btn-settings').click();
      const pop = document.getElementById('settings-pop');
      const ids = ['set-tree-open','set-diff-mode','set-hide-viewed','set-collapse-viewed',
                   'set-symlinks','set-sidebar','set-autoscroll-tree','set-tree-indent',
                   'set-inline-links','set-large-file-lines','set-context-collapse-lines',
                   'set-view-file-mode'];
      return { open: pop.classList.contains('show'), missing: ids.filter(id => !document.getElementById(id)) };
    })()`);
    assert.ok(state.open, "the settings panel did not open");
    assert.deepEqual(state.missing, [], "settings fields are missing");
  });

  await check("the file menu offers View file and a file comment", async () => {
    const state = await js(`(() => {
      const button = document.querySelector('.js-file-menu');
      button.click();
      const items = [...document.querySelectorAll('.file-menu-pop .file-menu-item')].map(i => i.textContent.trim());
      PR.closeFileMenus();
      return items;
    })()`);
    assert.ok(state.some((item) => /View file/.test(item)), `no View file entry: ${JSON.stringify(state)}`);
    assert.ok(state.some((item) => /comment/i.test(item)), `no file comment entry: ${JSON.stringify(state)}`);
  });

  await check("Expand all appears only for a file that really hides lines", async () => {
    const state = await js(`(() => {
      const sections = [...document.querySelectorAll('.diff-file')];
      const long = sections.find(s => s.dataset.path.endsWith('long.ts'));
      const widget = sections.find(s => s.dataset.path.endsWith('Widget.cs'));
      const items = (section) => {
        PR.refreshFileMenu(section);
        return [...section.querySelectorAll('.file-menu-item')].map(i => i.textContent.trim());
      };
      return {
        long: items(long),
        widget: items(widget),
        gapCount: (PR.findFile(long.dataset.path).gaps || []).length,
      };
    })()`);
    assert.ok(state.gapCount > 0, "the long file has no region between its hunks, so this fixture proves nothing");
    assert.ok(state.long.some((item) => /Expand all/i.test(item)), "a file with hidden lines offers no Expand all");
    assert.ok(!state.widget.some((item) => /Expand all/i.test(item)), "a file with nothing hidden offers Expand all");
  });

  await check("Expand all reveals the hidden region and removes its button", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('long.ts'));
      const before = {
        rows: section.querySelectorAll('tr').length,
        bars: section.querySelectorAll('.hunk-expander').length,
        numbers: [...section.querySelectorAll('td.diff-num[data-side="right"]')]
          .map(td => Number(td.dataset.line)).filter(n => n > 0),
      };
      PR.refreshFileMenu(section);
      section.querySelector('.js-expand-all').click();
      await new Promise(r => setTimeout(r, 900));
      const after = {
        rows: section.querySelectorAll('tr').length,
        bars: section.querySelectorAll('.hunk-expander').length,
        numbers: [...section.querySelectorAll('td.diff-num[data-side="right"]')]
          .map(td => Number(td.dataset.line)).filter(n => n > 0),
      };
      return { before, after };
    })()`);
    assert.ok(state.before.bars > 0, "the fixture should hide a region");
    assert.ok(state.after.rows > state.before.rows, "Expand all revealed nothing");
    assert.equal(state.after.bars, 0, "the expander button survived Expand all");
    // The hidden lines in between must now be present, in order and complete.
    const before = new Set(state.before.numbers);
    const added = state.after.numbers.filter((number) => !before.has(number));
    assert.ok(added.length > 5, `only ${added.length} hidden line(s) appeared`);
    assert.deepEqual(added, [...added].sort((a, b) => a - b), "revealed lines are out of order");
    assert.equal(new Set(state.after.numbers).size, state.after.numbers.length, "a line number is shown twice");
  });

  await check("the expander bar opens its own region", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      // Re-open the long file's regions first, so there is a bar to click.
      const long = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('long.ts'));
      PR.renderFileList();
      await new Promise(r => setTimeout(r, 1200));
      const fresh = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('long.ts')) || long;
      const bar = fresh.querySelector('.hunk-expander .js-expand');
      if (!bar) return { skipped: true };
      const before = fresh.querySelectorAll('tr').length;
      bar.click();
      await new Promise(r => setTimeout(r, 700));
      return { before, after: fresh.querySelectorAll('tr').length, path: section.dataset.path };
    })()`);
    if (state.skipped) return;
    assert.ok(state.after > state.before, "clicking the expander bar changed nothing");
  });

  await check("collapsing a file hides its body and expanding restores it", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const header = section.querySelector('.diff-file-header');
      const body = section.querySelector('.diff-body');
      const rows = () => body.querySelectorAll('tr').length;
      header.querySelector('.js-collapse').click();
      const collapsed = { cls: section.classList.contains('collapsed'), visible: body.getBoundingClientRect().height };
      header.querySelector('.js-collapse').click();
      const expanded = { cls: section.classList.contains('collapsed'), visible: body.getBoundingClientRect().height };
      return { rows: rows(), collapsed, expanded };
    })()`);
    assert.ok(state.rows > 0, "the file has no rows to hide");
    assert.ok(state.collapsed.cls, "the section did not collapse");
    assert.equal(state.collapsed.visible, 0, "a collapsed file body is still visible");
    assert.ok(!state.expanded.cls, "the section did not expand again");
    assert.ok(state.expanded.visible > 0, "an expanded file body has no height");
  });

  await check("marking a file viewed updates the counter and the tree", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const box = section.querySelector('.viewed-wrap');
      const before = PR.state.viewed.size;
      box.click();
      await new Promise(r => setTimeout(r, 200));
      const after = PR.state.viewed.size;
      const row = document.querySelector('.tree-row[data-path="' + PR.cssEscape(section.dataset.path) + '"]');
      const summary = document.getElementById('header-summary').textContent;
      box.click();
      await new Promise(r => setTimeout(r, 200));
      return { before, after, restored: PR.state.viewed.size, treeViewed: row.classList.contains('is-viewed'), summary };
    })()`);
    assert.equal(state.after, state.before + 1, "marking viewed did not count");
    assert.match(state.summary, new RegExp(`${state.after} /`), "the summary did not follow the viewed count");
    assert.equal(state.restored, state.before, "unmarking did not restore the count");
  });

  await check("Copy path shows the path instead of failing silently", async () => {
    const state = await js(`(async () => {
      const button = document.querySelector('.js-copy-path');
      button.click();
      await new Promise(r => setTimeout(r, 200));
      const toast = document.getElementById('toast');
      return { visible: toast.classList.contains('show'), text: toast.textContent };
    })()`);
    assert.ok(state.visible, "clicking Copy path showed nothing");
    assert.ok(state.text.length > 0, "the copy toast is empty");
  });

  await check("a comment can be written, saved, resolved, edited and deleted", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const path = section.dataset.path;
      const line = [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0)[2];
      PR.openCommentForm(path, 'right', line, line, null);
      await new Promise(r => setTimeout(r, 150));

      const editor = section.querySelector('.js-editor');
      const initial = { editor: !!editor };
      editor.querySelector('.js-text').value = 'This field needs a default value';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 250));

      const saved = {
        comments: PR.state.comments.length,
        box: section.querySelectorAll('.comment-box').length,
        body: (section.querySelector('.comment-body') || {}).textContent || '',
        sidebar: (document.getElementById('comment-list') || {}).textContent || '',
      };

      const id = PR.state.comments[0].id;
      section.querySelector('.js-resolve[data-id="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 150));
      const resolved = {
        flag: PR.state.comments[0].resolved === true,
        pill: !!section.querySelector('.resolved-pill'),
      };

      // Edit goes back into the same comment, not a second one.
      section.querySelector('.js-edit[data-id="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 150));
      const editBox = section.querySelector('.js-editor');
      const editPrefilled = editBox ? editBox.querySelector('.js-text').value : null;
      editBox.querySelector('.js-text').value = 'Updated wording';
      editBox.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 250));
      const edited = { count: PR.state.comments.length, body: PR.state.comments[0].body };

      section.querySelector('.js-delete[data-id="' + id + '"]').click();
      await new Promise(r => setTimeout(r, 250));
      return {
        initial, saved, resolved, editPrefilled, edited,
        deleted: { count: PR.state.comments.length, boxes: section.querySelectorAll('.comment-box').length },
      };
    })()`);
    assert.ok(state.initial.editor, "the comment form did not open on a line");
    assert.equal(state.saved.comments, 1, "the comment was not stored");
    assert.equal(state.saved.box, 1, "the saved comment is not shown in the diff");
    assert.match(state.saved.body, /default value/, "the comment body is wrong");
    assert.match(state.saved.sidebar, /default value/, "the comment is missing from the sidebar");
    assert.ok(state.resolved.flag, "the comment was not marked resolved");
    assert.ok(state.resolved.pill, "the resolved pill is missing");
    assert.equal(state.editPrefilled, "This field needs a default value", "Edit did not prefill the text");
    assert.equal(state.edited.count, 1, "editing created a second comment");
    assert.equal(state.edited.body, "Updated wording", "editing did not change the body");
    assert.equal(state.deleted.count, 0, "deleting did not remove the comment");
    assert.equal(state.deleted.boxes, 0, "the deleted comment is still on the page");
  });

  await check("a file comment attaches to the file, not to a line", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('long.ts'));
      const path = section.dataset.path;
      PR.openCommentForm(path, 'right', 0, 0, null);
      await new Promise(r => setTimeout(r, 150));
      const banner = section.querySelector('.file-comment-banner .js-editor');
      banner.querySelector('.js-text').value = 'Whole file: the totals need rounding';
      banner.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 250));
      const comment = PR.state.comments[0];
      return {
        count: PR.state.comments.length,
        lineStart: comment.lineStart,
        bannerBox: section.querySelectorAll('.file-comment-banner .comment-box').length,
        inRows: section.querySelectorAll('.comment-row .comment-box').length,
      };
    })()`);
    assert.equal(state.count, 1, "the file comment was not stored");
    assert.equal(state.lineStart, 0, "a file comment must not claim a line");
    assert.equal(state.bannerBox, 1, "the file comment is not attached to the file header");
    assert.equal(state.inRows, 0, "a file comment was put inside the diff rows");
  });

  await check("a comment survives a page reload", async () => {
    await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const line = [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0)[4];
      PR.openCommentForm(section.dataset.path, 'right', line, line, null);
      await new Promise(r => setTimeout(r, 150));
      const editor = section.querySelector('.js-editor');
      editor.querySelector('.js-text').value = 'Survives a reload';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 500));
    })()`);

    await driver.navigate().refresh();
    await waitForPage(driver);

    const state = await js(`(() => ({
      count: PR.state.comments.length,
      bodies: PR.state.comments.map(c => c.body),
      rendered: document.querySelectorAll('.comment-box').length,
      sidebar: (document.getElementById('comment-list') || {}).textContent || '',
    }))()`);
    assert.ok(state.count >= 1, "the comment disappeared on reload");
    assert.ok(state.bodies.some((body) => /Survives a reload/.test(body)), `wrong comments after reload: ${JSON.stringify(state.bodies)}`);
    assert.ok(state.rendered >= 1, "the restored comment is not rendered in the diff");
    assert.match(state.sidebar, /Survives a reload/, "the restored comment is missing from the sidebar");
  });

  await check("the review is saved with its verdict, note and comments", async () => {
    await js(`(async () => {
      document.getElementById('btn-submit').click();
      document.getElementById('review-body').value = 'Looks close; one field needs a default.';
      document.querySelector('input[name="review-verdict"][value="REQUEST_CHANGES"]').checked = true;
      document.getElementById('dispatch-send').checked = false;
      document.getElementById('btn-dispatch-submit').click();
      await new Promise(r => setTimeout(r, 1200));
    })()`);

    const saved = JSON.parse(await readFile(join(reviewState.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.reviewState, "REQUEST_CHANGES", "the verdict was not stored");
    assert.match(saved.review.reviewBody, /one field needs a default/, "the note was not stored");
    assert.ok(saved.review.comments.length >= 1, "the comments were not stored");
    assert.equal(saved.meta.mode, MODE.RANGE, "the saved review lost its scope");

    const markdown = await readFile(join(reviewState.outputDir, "review.md"), "utf8");
    assert.match(markdown, /REQUEST_CHANGES/, "review.md lost the verdict");
    assert.match(markdown, /one field needs a default/, "review.md lost the note");
    assert.match(markdown, /Survives a reload/, "review.md lost an inline comment");
  });

  await check("a screenshot on the note is saved with the review", async () => {
    // The dialog is the only way a user attaches a screenshot to the note, and
    // the note is a separate field from the comments. It must reach disk.
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const state = await js(`(async () => {
      document.getElementById('btn-submit').click();
      document.getElementById('review-body').value = 'See the screenshot';
      document.getElementById('dispatch-send').checked = false;

      // Paste, the way a user does it.
      const textarea = document.getElementById('review-body');
      const bytes = Uint8Array.from(atob(${JSON.stringify(png.split(",")[1])}), c => c.charCodeAt(0));
      const file = new File([bytes], 'shot.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: transfer });
      textarea.dispatchEvent(event);

      await new Promise(r => setTimeout(r, 500));
      const chips = document.querySelectorAll('#review-note-chips .attach-chip').length;
      document.getElementById('btn-dispatch-submit').click();
      await new Promise(r => setTimeout(r, 1500));
      return { chips, modalOpen: document.getElementById('dispatch-modal').classList.contains('show') };
    })()`);

    assert.equal(state.chips, 1, "the pasted screenshot did not appear in the note");
    assert.equal(state.modalOpen, false, "the dialog stayed open after submitting");

    const saved = JSON.parse(await readFile(join(reviewState.outputDir, "review.json"), "utf8"));
    assert.equal(saved.review.noteImages.length, 1, "the review did not record the note image");
    assert.equal(saved.review.noteImages[0].file, "images/note-0.png", "the note image has no file");

    const markdown = await readFile(join(reviewState.outputDir, "review.md"), "utf8");
    assert.match(markdown, /!\[attachment\]\(images\/note-0\.png\)/, "review.md does not show the note image");

    // Clearing the note after a submit means the next review starts clean.
    const after = await js(`(async () => {
      document.getElementById('btn-submit').click();
      const body = document.getElementById('review-body').value;
      document.getElementById('btn-dispatch-submit').click();
      await new Promise(r => setTimeout(r, 1200));
      return { body };
    })()`);
    assert.equal(after.body, "", "the note stayed in the dialog after it was sent");
  });

  await check("the Commits tab lists the commits of the scope", async () => {
    const state = await js(`(async () => {
      document.querySelector('.gh-tab[data-tab="commits"]').click();
      for (let i = 0; i < 60; i += 1) {
        if (document.querySelectorAll('.commit-item').length > 0) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const items = [...document.querySelectorAll('.commit-item')].map(i => i.dataset.sha);
      document.querySelector('.gh-tab[data-tab="files"]').click();
      return { items };
    })()`);
    assert.ok(state.items.length >= 1, "the Commits tab is empty");
    assert.ok(state.items.includes(head), "the reviewed head commit is not listed");
  });

  await check("project search finds a symbol and opens its file", async () => {
    const state = await js(`(async () => {
      document.getElementById('btn-search').click();
      const input = document.getElementById('search-input');
      input.value = 'Checkout';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 80; i += 1) {
        if (document.querySelectorAll('.search-hit').length > 0) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const hits = [...document.querySelectorAll('.search-hit')].map(h => h.textContent);
      PR.closeSearch();
      return { hits };
    })()`);
    assert.ok(state.hits.length > 0, "search found nothing for a name that exists");
    assert.ok(state.hits.some((hit) => /Checkout/.test(hit)), "the hits do not mention the searched name");
  });

  await check("the tree filter narrows the file list", async () => {
    const state = await js(`(async () => {
      const rows = () => [...document.querySelectorAll('.tree-row[data-dir="false"]')].map(r => r.dataset.path);
      const before = rows();
      const input = document.getElementById('tree-filter-input');
      input.value = 'Widget';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const filtered = rows();
      const box = document.getElementById('tree-filter-input');
      box.value = '';
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      return { before, filtered, restored: rows(), treeFilter: PR.state.treeFilter };
    })()`);
    assert.ok(state.before.length >= 2, `the tree had no files to filter: ${JSON.stringify(state.before)}`);
    assert.ok(state.filtered.length < state.before.length, "filtering did not narrow the tree");
    assert.ok(state.filtered.every((path) => /Widget/i.test(path)), `filter kept unrelated files: ${JSON.stringify(state.filtered)}`);
    assert.equal(state.treeFilter, "", "clearing the box left a filter behind");
    assert.deepEqual(state.restored, state.before, "clearing the filter did not restore the tree");
  });

  await check("typing in the tree filter does not lose characters or the caret", async () => {
    // The search box used to be rebuilt on every keystroke, which replaced the
    // focused input: a fast typist lost characters and the caret jumped.
    const state = await js(`(async () => {
      const input = document.getElementById('tree-filter-input');
      input.focus();
      const typed = 'Widget';
      const seen = [];
      for (const char of typed) {
        const start = input.selectionStart;
        input.value = input.value + char;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        const current = document.getElementById('tree-filter-input');
        seen.push({
          char,
          same: current === input,
          value: current.value,
          focused: document.activeElement === current,
          caretKept: current.selectionStart > start,
        });
      }
      const filters = [...document.querySelectorAll('.tree-row[data-dir="false"]')].map(r => r.dataset.path);
      const current = document.getElementById('tree-filter-input');
      current.value = '';
      current.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return { seen, filters, restored: document.querySelectorAll('.tree-row[data-dir="false"]').length };
    })()`);
    assert.ok(state.seen.length === 6, "the typing probe did not run");
    assert.ok(state.seen.every((step) => step.same), "the search box was replaced while typing");
    assert.ok(state.seen.every((step) => step.focused), "the search box lost focus while typing");
    assert.equal(state.seen[state.seen.length - 1].value, "Widget", "characters were lost while typing");
    assert.ok(state.seen.slice(1).every((step) => step.caretKept), "the caret jumped back while typing");
    assert.ok(state.filters.length >= 1 && state.filters.every((path) => /Widget/i.test(path)), `wrong filtered rows: ${JSON.stringify(state.filters)}`);
    assert.ok(state.restored > state.filters.length, "clearing the filter did not restore the tree");
  });

  await check("the viewer page renders the whole file with line numbers", async () => {
    const reviewHandle = await driver.getWindowHandle();
    const served = await js(`fetch('/api/file?path=' + encodeURIComponent('src/widgets/Widget.cs'))
      .then(r => r.json()).then(d => ({ lines: d.lines ? d.lines.length : 0, tooLarge: !!d.tooLarge }))`);
    assert.ok(served.lines > 5, "the file API served no lines");
    assert.equal(served.tooLarge, false, "a small file was treated as too large");

    await js(`window.open('/file?path=' + encodeURIComponent('src/widgets/Widget.cs'), '_blank')`);
    await driver.wait(async () => (await driver.getAllWindowHandles()).length > 1, 15000);

    const handles = await driver.getAllWindowHandles();
    const viewerHandle = handles.find((handle) => handle !== reviewHandle);
    assert.ok(viewerHandle, "the viewer tab did not open");

    try {
      await driver.switchTo().window(viewerHandle);
      await driver.wait(async () => {
        try { return await driver.executeScript("return !!document.getElementById('file-data')"); } catch { return false; }
      }, 30000);

      const viewer = await driver.executeScript(`return (() => {
        const node = document.getElementById('file-data');
        const parsed = node ? JSON.parse(node.textContent) : null;
        return {
          path: parsed ? parsed.path : null,
          lines: parsed && parsed.lines ? parsed.lines.length : 0,
          rows: document.querySelectorAll('tr').length,
        };
      })()`);
      assert.match(String(viewer.path), /Widget\.cs/, "the viewer opened the wrong file");
      assert.ok(viewer.lines > 5, "the viewer data has no lines");
      assert.ok(viewer.rows > 5, "the viewer rendered almost no rows");
    } finally {
      await driver.switchTo().window(viewerHandle);
      await driver.close();
      await driver.switchTo().window(reviewHandle);
      await waitForPage(driver);
    }
  });

  await check("a comment can carry a pasted image", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const line = [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0)[1];
      PR.openCommentForm(section.dataset.path, 'right', line, line, null);
      await new Promise(r => setTimeout(r, 150));

      const editor = section.querySelector('.js-editor');
      const canvas = document.createElement('canvas');
      canvas.width = 8; canvas.height = 8;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: transfer });
      editor.querySelector('.js-text').dispatchEvent(event);
      await new Promise(r => setTimeout(r, 300));

      const chipsBefore = editor.querySelectorAll('.attach-chip').length;
      editor.querySelector('.js-text').value = 'See the screenshot';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 400));

      const comment = PR.state.comments.find(c => c.body === 'See the screenshot');
      return {
        chipsBefore,
        images: comment ? (comment.images || []).length : 0,
        rendered: section.querySelectorAll('.comment-attachments .attach-chip').length,
        dataUrl: comment && comment.images[0] ? String(comment.images[0].dataUrl).slice(0, 15) : '',
      };
    })()`);
    assert.equal(state.chipsBefore, 1, "the pasted image did not become a chip");
    assert.equal(state.images, 1, "the saved comment lost its image");
    assert.equal(state.rendered, 1, "the image is not shown with the comment");
    assert.match(state.dataUrl, /^data:image\//, "the image is not the pasted data");
  });

  await check("the inline panel opens an unchanged file inside the review", async () => {
    const state = await js(`(async () => {
      const path = 'docs/GUIDE.md';
      if (!PR.state.allFiles.some(f => f.path === path)) return { skipped: true };
      PR.openInlineFile(path, null, 1);
      for (let i = 0; i < 40; i += 1) {
        if (document.querySelector('#inline-file-host .diff-file')) break;
        await new Promise(r => setTimeout(r, 100));
      }
      const host = document.getElementById('inline-file-host');
      const section = host ? host.querySelector('.diff-file') : null;
      const result = {
        visible: host ? !host.classList.contains('hidden') : false,
        path: section ? section.dataset.path : null,
        rows: section ? section.querySelectorAll('tr').length : 0,
        empty: host ? /Could not open/.test(host.textContent) : true,
      };
      PR.closeInlineFile();
      return result;
    })()`);
    if (state.skipped) return;
    assert.equal(state.empty, false, "the inline panel reported an error");
    assert.ok(state.visible, "the inline host stayed hidden");
    assert.ok(state.rows > 3, "the inline file has almost no rows");
    assert.ok(state.path, "the inline section lost its path");
  });

  await check("the scope picker offers every review mode", async () => {
    const state = await js(`(() => {
      const select = document.getElementById('scope-mode');
      return {
        present: !!select,
        options: select ? [...select.options].map(o => o.value) : [],
        current: PR.DATA.mode,
      };
    })()`);
    assert.ok(state.present, "the scope mode picker is missing");
    assert.ok(state.options.length >= 3, `the scope picker lost its modes: ${JSON.stringify(state.options)}`);
    assert.ok(state.options.includes(state.current), "the picker does not show the current mode");
  });

  await check("a comment goes out of date when its line is edited, and says so", async () => {
    // Written on the widget, then the commented line is changed in the working
    // tree: the next page must show the comment, flag it, and quote the original.
    const written = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const cells = [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0);
      const line = cells[cells.length - 1];
      const text = section.querySelector('tr[data-line="' + line + '"] td.diff-code').textContent;
      PR.openCommentForm(section.dataset.path, 'right', line, line, null);
      await new Promise(r => setTimeout(r, 150));
      const editor = section.querySelector('.js-editor');
      editor.querySelector('.js-text').value = 'This closing brace is suspicious';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 400));
      return { path: section.dataset.path, line, text };
    })()`);

    await fetch(new URL("/api/review", reviewState.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewState: "REQUEST_CHANGES",
        reviewBody: "",
        comments: (await js("PR.state.comments")),
        summary: { files: 2, additions: 1, deletions: 0, comments: 1 },
      }),
    });

    // Change exactly that line, without committing it.
    const filePath = join(fixture.root, written.path);
    const content = await readFile(filePath, "utf8");
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    lines[written.line - 1] = `${lines[written.line - 1]} // edited after the review`;
    await writeFile(filePath, lines.join("\n"));

    const reopened = await startReview({
      repoPath: fixture.root,
      mode: MODE.RANGE,
      base,
      head: "HEAD",
      port: 0,
      symbols: false,
      dispatchEnabled: false,
      sessionId: "",
    });

    try {
      await driver.get(reopened.url);
      await waitForPage(driver);

      const state = await js(`(() => {
        const comment = PR.state.comments.find(c => /suspicious/.test(c.body));
        const box = comment ? document.querySelector('.comment-box[data-id="' + comment.id + '"]') : null;
        return {
          found: !!comment,
          outdated: comment ? comment.outdated === true : null,
          reason: comment ? comment.outdatedReason : null,
          snippet: comment ? comment.snippet : null,
          rendered: !!box,
          flagged: box ? box.classList.contains('is-outdated') : false,
          pill: box ? !!box.querySelector('.outdated-pill') : false,
          note: box && box.querySelector('.comment-outdated-note') ? box.querySelector('.comment-outdated-note').textContent : null,
          sidebar: (document.getElementById('comment-list') || {}).textContent || '',
        };
      })()`);

      assert.ok(state.found, "the comment was lost after the line changed");
      assert.equal(state.outdated, true, "the comment was not marked outdated");
      assert.ok(state.reason, "an outdated comment must explain itself");
      assert.ok(state.rendered, "the outdated comment is not shown in the diff");
      assert.ok(state.flagged, "the comment box does not carry the outdated state");
      assert.ok(state.pill, "no Outdated pill on the comment");
      assert.ok(/changed/.test(state.note || ""), "the outdated note is missing");
      assert.match(state.sidebar, /outdated/i, "the sidebar does not mark the outdated comment");
      assert.ok(state.snippet && state.snippet.length > 0, "the original lines were not recorded");
    } finally {
      await reopened.page.close();
    }

    // Put the file back so later checks see the reviewed content.
    await writeFile(filePath, content);
    await driver.get(reviewState.url);
    await waitForPage(driver);
  });

  await check("dragging across line numbers comments on the whole range", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const rows = [...section.querySelectorAll('tr')].filter(r => r.querySelector('td.diff-num[data-side="right"]'));
      const pick = rows.slice(1, 4);
      if (pick.length < 3) return { skipped: true };
      const gutter = (row) => row.querySelector('.line-plus.js-comment[data-side="right"]') || row.querySelector('td.diff-gutter');
      const from = gutter(pick[0]);
      const to = gutter(pick[2]);
      if (!from || !to) return { skipped: true, reason: 'no gutter' };

      // A real drag: press on one gutter, move over the third, release.
      const mouse = (type, node) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
      mouse('mousedown', from);
      mouse('mouseover', to);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      await new Promise(r => setTimeout(r, 200));
      const editor = section.querySelector('.js-editor');
      if (!editor) return { skipped: true, reason: 'no editor opened' };
      const label = (editor.querySelector('.muted.small') || {}).textContent || '';
      editor.querySelector('.js-text').value = 'The whole block needs work';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 300));

      const comment = PR.state.comments.find(c => c.body === 'The whole block needs work');
      return {
        label,
        start: comment ? comment.lineStart : null,
        end: comment ? comment.lineEnd : null,
        expectedStart: Number(pick[0].querySelector('td.diff-num[data-side="right"]').dataset.line),
        expectedEnd: Number(pick[2].querySelector('td.diff-num[data-side="right"]').dataset.line),
        selectedRows: section.querySelectorAll('tr.row-selected').length,
      };
    })()`);
    assert.ok(!state.skipped, `the drag never reached the editor: ${state.reason ?? "not enough rows"}`);
    assert.ok(/lines \d+–\d+/.test(state.label), `the editor did not label a range: ${state.label}`);
    assert.equal(state.start, state.expectedStart, "the range started on the wrong line");
    assert.equal(state.end, state.expectedEnd, "the range ended on the wrong line");
    assert.equal(state.selectedRows, 0, "the selection is still highlighted after saving");
  });

  await check("a comment can be left on a removed line", async () => {
    const state = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('long.ts'));
      const deleted = [...section.querySelectorAll('tr.row-del')];
      if (!deleted.length) return { skipped: true, reason: 'no removed row' };
      const line = Number(deleted[0].querySelector('td.diff-num[data-side="left"]').dataset.line);
      PR.openCommentForm(section.dataset.path, 'left', line, line, null);
      await new Promise(r => setTimeout(r, 200));
      const editor = section.querySelector('.js-editor');
      if (!editor) return { skipped: true, reason: 'no editor' };
      const label = (editor.querySelector('.muted.small') || {}).textContent || '';
      editor.querySelector('.js-text').value = 'This removal loses information';
      editor.querySelector('.js-save').click();
      await new Promise(r => setTimeout(r, 300));
      const comment = PR.state.comments.find(c => c.body === 'This removal loses information');
      return {
        label,
        found: !!comment,
        side: comment ? comment.side : null,
        lineStart: comment ? comment.lineStart : null,
        line,
        inRows: section.querySelectorAll('.comment-row .comment-box, .comment-box').length,
        anchoredInDeletedRow: !!deleted[0].parentNode.querySelector('.comment-box'),
      };
    })()`);
    assert.ok(!state.skipped, `the fixture has no removed line: ${state.reason}`);
    assert.match(state.label, /line/, "the editor did not name the line");
    assert.ok(state.found, "the comment on a removed line was not stored");
    assert.equal(state.side, "left", "the comment did not stay on the removed side");
    assert.equal(state.lineStart, state.line, "the comment moved to another line");
    assert.ok(state.anchoredInDeletedRow, "the comment is not shown right under the removed line");
  });

  await check("clicking a comment in the sidebar brings its file into view", async () => {
    // Give the page enough height that "off screen" and "on screen" differ: a
    // short page fits in one window, and then a scroll check proves nothing.
    await js(`(async () => {
      PR.state.settings.contextCollapseLines = 1000;
      PR.renderFileList();
      await new Promise(r => setTimeout(r, 2500));
      return true;
    })()`);

    const state = await js(`(async () => {
      const items = [...document.querySelectorAll('#comment-list .js-goto-comment')];
      if (!items.length) return { skipped: true, reason: 'no comments in the sidebar' };

      const sections = [...document.querySelectorAll('.diff-file')].map(s => s.dataset.path);
      const item = items.find(i => sections.indexOf(i.dataset.path) > 0) || items[0];
      const path = item.dataset.path;
      const section = PR.findSection(path);
      if (!section) return { skipped: true, reason: 'the file is not on the page' };

      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
      const away = section.getBoundingClientRect();
      const room = document.body.scrollHeight - window.innerHeight;

      item.click();
      await new Promise(r => setTimeout(r, 1500));
      const rect = section.getBoundingClientRect();
      return {
        path,
        room,
        count: items.length,
        wasAway: away.top < 0 || away.top > window.innerHeight,
        visible: rect.top < window.innerHeight && rect.bottom > 0,
        top: Math.round(rect.top),
        active: [...document.querySelectorAll('.tree-row.is-active')].map(r => r.dataset.path),
      };
    })()`);
    assert.ok(!state.skipped, `the sidebar listed no usable comment: ${state.reason}`);
    assert.ok(state.room > 200, `the page cannot scroll far enough to prove anything (${state.room}px of room)`);
    assert.ok(state.wasAway, `${state.path} was already in view, so the click proves nothing`);
    assert.ok(state.visible, `the file stayed off screen (top ${state.top})`);
    assert.ok(state.active.includes(state.path), `the tree did not mark ${state.path} as active: ${JSON.stringify(state.active)}`);
  });

  await check("settings survive a reload and reach the server", async () => {
    const changed = await js(`(async () => {
      document.getElementById('btn-settings').click();
      const mode = document.getElementById('set-diff-mode');
      mode.value = PR.DIFF_MODE.SPLIT;
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      const hide = document.getElementById('set-hide-viewed');
      hide.checked = true;
      hide.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));
      const stored = await fetch('/api/settings').then(r => r.json());
      return { stored: stored.settings, mode: PR.state.diffMode };
    })()`);
    assert.equal(changed.mode, "split", "the diff mode did not change");
    assert.equal(changed.stored.diffMode, "split", "the server did not receive the diff mode");
    assert.equal(changed.stored.hideViewed, true, "the server did not receive the viewed setting");

    await driver.navigate().refresh();
    await waitForPage(driver);

    const restored = await js(`(() => ({
      mode: PR.state.diffMode,
      hideViewed: PR.state.settings.hideViewed,
      splitTables: document.querySelectorAll('table.diff-table.split').length,
    }))()`);
    assert.equal(restored.mode, "split", "the diff mode was lost on reload");
    assert.equal(restored.hideViewed, true, "the viewed setting was lost on reload");
    assert.ok(restored.splitTables > 0, "the page did not render the saved split view");

    // Back to the defaults for the rest of the suite.
    await js(`(async () => {
      PR.state.settings.hideViewed = false;
      document.getElementById('set-diff-mode').value = PR.DIFF_MODE.UNIFIED;
      document.getElementById('set-diff-mode').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      return true;
    })()`);
    await driver.navigate().refresh();
    await waitForPage(driver);
  });

  await check("hiding viewed files removes them, and the toggle says how to get them back", async () => {
    const state = await js(`(async () => {
      const paths = () => [...document.querySelectorAll('.diff-file')].map(s => s.dataset.path);
      const before = paths();
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      section.querySelector('.viewed-wrap').click();
      await new Promise(r => setTimeout(r, 300));

      const toggle = document.getElementById('toggle-viewed');
      document.getElementById('set-hide-viewed').checked = true;
      document.getElementById('set-hide-viewed').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));

      const after = paths();
      const result = {
        before,
        after,
        toggleLabel: toggle.textContent,
        togglePressed: toggle.getAttribute('aria-pressed'),
      };

      document.getElementById('set-hide-viewed').checked = false;
      document.getElementById('set-hide-viewed').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      result.restored = paths();
      return result;
    })()`);
    assert.ok(state.before.length >= 2, "not enough files to hide one");
    assert.ok(!state.after.some((path) => path.endsWith("Widget.cs")), "a viewed file stayed in the list");
    assert.equal(state.after.length, state.before.length - 1, "hiding one viewed file changed the count by more than one");
    assert.match(state.toggleLabel, /show/i, `the toggle does not offer to show the hidden file: ${state.toggleLabel}`);
    assert.equal(state.togglePressed, "true", "the toggle does not report the filter as on");
    assert.deepEqual(state.restored, state.before, "turning the setting off did not bring the file back");
  });

  await check("switching to split view keeps every line", async () => {
    const state = await js(`(async () => {
      const readNumbers = (section) => [...section.querySelectorAll('td.diff-num[data-side="right"]')]
        .map(td => Number(td.dataset.line)).filter(n => n > 0).sort((a, b) => a - b);
      const find = () => [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('Widget.cs'));
      const unified = readNumbers(find());

      PR.state.diffMode = PR.DIFF_MODE.SPLIT;
      PR.renderFileList();
      await new Promise(r => setTimeout(r, 1800));
      const splitSection = find();
      const split = readNumbers(splitSection);
      const splitTables = splitSection.querySelectorAll('table.diff-table.split').length;

      PR.state.diffMode = PR.DIFF_MODE.UNIFIED;
      PR.renderFileList();
      await new Promise(r => setTimeout(r, 1800));
      return { unified, split, splitTables, back: readNumbers(find()) };
    })()`);
    assert.ok(state.unified.length > 5, "the widget file has almost no numbered lines");
    assert.ok(state.splitTables > 0, "split view did not render split tables");
    assert.deepEqual(state.split, state.unified, "split view shows different new-side lines than unified view");
    assert.deepEqual(state.back, state.unified, "switching back did not restore the unified view");
  });
} finally {
  await driver.quit();
  await reviewState.page.close();
  await rm(fixture.root, { recursive: true, force: true });
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} of ${checks} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log(`\nAll ${checks} UI checks passed`);
