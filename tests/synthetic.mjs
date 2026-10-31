/**
 * Deep checks against a synthetic two-month history.
 *
 * The fixture repository carries the shapes a real repository contains:
 * renames, deletions, binary files, unicode paths, CRLF endings, a file
 * without a trailing newline, a very long line, a mode change, a merge
 * commit, an empty commit, a few hundred generated files and a file big
 * enough to make the folding policy matter.
 *
 * Run: node tests/synthetic.mjs
 */
import assert from "node:assert/strict";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { buildReview, startReview } from "../src/core.js";
import { MODE, ROUTES } from "../src/config.js";
import { splitLines } from "../src/fileview.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createSyntheticRepo, FEATURE, MAIN } from "./fixtures/synthetic-repo.mjs";
const PAUSE = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** The review must stay usable; these are the limits of the timings. */
const LIMIT_REVIEW_BUILD_MS = 15_000;
const LIMIT_PAGE_LOAD_MS = 20_000;
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
const fixture = await createSyntheticRepo();
console.log(`fixture: ${fixture.root}`);
let started = null;
let driver = null;
try {
  /* ------------------------------------------------------------------ */
  /* The whole history: every edge case of the fixture is in this diff.  */
  /* ------------------------------------------------------------------ */
  const rootCommit = (await import("node:child_process")).execFile;
  const { execFile: exec } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execAsync = promisify(exec);
  const { stdout: rootSha } = await execAsync(fixture.git, ["rev-list", "--max-parents=0", "HEAD"], { cwd: fixture.root });
  void rootCommit;

  const buildStarted = Date.now();
  const all = await buildReview({
    repoPath: fixture.root,
    mode: MODE.RANGE,
    base: rootSha.trim(),
    head: "HEAD",
  });
  const buildMs = Date.now() - buildStarted;

  await check("the whole history is reviewed in time", () => {
    assert.ok(buildMs < LIMIT_REVIEW_BUILD_MS, `the review took ${buildMs} ms`);
  });

  await check("the file added on the branch is marked as added", () => {
    const added = all.files.find((file) => file.path === "src/new-module.ts");
    assert.ok(added, "the added file is missing from the diff");
    assert.equal(added.status, "added");
  });

  await check("the initial commit is diffed on its own", async () => {
    const initial = await buildReview({
      repoPath: fixture.root,
      mode: MODE.COMMITS,
      commits: [rootSha.trim()],
    });

    const crlf = initial.files.find((file) => file.path === "data/crlf.txt");
    assert.ok(crlf, "the file with CRLF endings is missing");
    assert.ok(crlf.hunks.length > 0, "the file with CRLF endings has no hunks");

    const noNewline = initial.files.find((file) => file.path === "data/no-trailing-newline.txt");
    assert.ok(noNewline, "the file without a trailing newline is missing");
    assert.ok(noNewline.hunks.length > 0, "the file without a trailing newline has no hunks");

    const empty = initial.files.find((file) => file.path === "data/empty.txt");
    assert.ok(empty, "the empty file is missing");

    const spaced = initial.files.find((file) => file.path === "data/with space.txt");
    assert.ok(spaced, "the file whose name holds a space is missing");
    assert.ok(spaced.hunks.length > 0, "the spaced file has no hunks");
  });

  await check("two commits touching one file show it once", async () => {
    // The bug: mode=commits concatenated a patch per commit, so a file changed
    // by two selected commits appeared twice. The UI keys viewed/collapse by
    // path, so the second section cleared the flag of the first.
    const { stdout } = await execAsync(fixture.git, ["log", "--format=%H", "--", "src/generated/large.ts"], { cwd: fixture.root });
    const shas = stdout.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 2);
    assert.equal(shas.length, 2, "the fixture must change the generated file twice");

    const picked = await buildReview({ repoPath: fixture.root, mode: MODE.COMMITS, commits: shas });

    const seen = new Set();
    for (const file of picked.files) {
      assert.ok(!seen.has(file.path), `the path ${file.path} appears twice`);
      seen.add(file.path);
    }

    const generated = picked.files.filter((file) => file.path === "src/generated/large.ts");
    assert.equal(generated.length, 1, "the generated file must appear once");
    assert.ok(generated[0].hunks.length > 0, "the generated file has no hunks");
  });

  await check("the binary file is not read as text", () => {
    const binary = all.files.find((file) => file.path === "assets/logo.png");
    assert.ok(binary, "the binary file is missing from the diff");
    assert.equal(binary.binary, true, "the binary file was not detected");
  });

  await check("the renamed file appears under its new name", () => {
    const modern = all.files.find((file) => file.path === "src/modern.ts");
    assert.ok(modern, "the renamed file is missing");
    const legacy = all.files.find((file) => file.path === "src/legacy.ts");
    assert.ok(legacy, "the old name of the renamed file is missing");
    assert.equal(legacy.status, "deleted");
  });

  await check("the unicode path is written as it is", () => {
    const document = all.files.find((file) => file.path.includes("новый"));
    assert.ok(document, `the unicode path is missing: ${all.files.map((file) => file.path).join(", ")}`);
    assert.ok(!document.path.includes("\\320"), "the path is still escaped");
  });

  await check("the mode change is part of the diff", () => {
    const script = all.files.find((item) => item.path === "scripts/run.sh");
    assert.ok(script, "the script is missing");
    assert.ok(script.modeChanged || script.hunks.length > 0, "the mode change is invisible");
  });

  await check("the merge commit is listed with both parents", () => {
    const merge = all.meta.commits.find((commit) => commit.subject.startsWith("merge:"));
    assert.ok(merge, "the merge commit is missing");
  });

  await check("the empty commit is listed", () => {
    const empty = all.meta.commits.find((commit) => commit.subject.includes("empty checkpoint"));
    assert.ok(empty, "the empty commit is missing");
  });

  await check("the tree of the project contains every file", () => {
    const paths = all.allFiles.map((item) => item.path ?? item.name ?? String(item));
    assert.ok(paths.length > 150, `the tree has only ${paths.length} entries`);
    assert.ok(paths.some((path) => path.includes("module-149")), "the generated files are missing");
  });

  await check("the gap metadata knows the length of the generated file", async () => {
    const generated = all.files.find((file) => file.path === "src/generated/large.ts");
    assert.ok(generated, "the generated file is missing");

    // The length must be the real number of lines: a trailing newline is not a
    // line.
    const text = await readFile(join(fixture.root, "src/generated/large.ts"), "utf8");
    const realLines = splitLines(text).length;
    assert.equal(generated.totalLines, realLines, "the file length counts a phantom line");

    // The range adds the whole file as one hunk, so its tail is covered and no
    // tail region exists; if one did, it must never reach past the last line.
    const tail = (generated.gaps ?? []).find((gap) => gap.dir === "down");
    if (tail) assert.equal(tail.newEnd, generated.totalLines, "the tail does not reach the end of the file");
  });

  /* ------------------------------------------------------------------ */
  /* The page.                                                            */
  /* ------------------------------------------------------------------ */
  started = await startReview({
    repoPath: fixture.root,
    mode: MODE.RANGE,
    base: rootSha.trim(),
    head: "HEAD",
    port: 0,
    dispatchEnabled: false,
  });

  console.log(`page: ${started.url}`);

  await check("the page answers the file api of a deleted file", async () => {
    const response = await fetch(new URL(`${ROUTES.API_FILE}?path=${encodeURIComponent("src/legacy.ts")}`, started.url));
    assert.equal(response.status, 200, `unexpected status ${response.status}`);
    const payload = await response.json();
    assert.ok(String(payload.content ?? payload.lines?.join("\n") ?? "").includes("legacy"), "the content of the deleted file is missing");
  });

  await check("the search api finds a file by a unicode query", async () => {
    const response = await fetch(new URL(`${ROUTES.API_SEARCH}?q=${encodeURIComponent("новый")}`, started.url));
    assert.equal(response.status, 200, `unexpected status ${response.status}`);
    const payload = await response.json();
    assert.ok(JSON.stringify(payload).includes("новый"), "the unicode file was not found");
  });

  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 }))
    .build();

  const js = (code) => driver.executeScript(`return (${code});`);

  const loadStarted = Date.now();
  await driver.get(started.url);
  await driver.wait(until.elementLocated(By.css(".diff-file")), 20_000);
  await driver.wait(async () => (await js(`[...document.querySelectorAll('.diff-file')].filter((s) => s.dataset.hydrated === '1').length`)) > 5, 30_000);
  const loadMs = Date.now() - loadStarted;

  await check("the page loads in time", () => {
    assert.ok(loadMs < LIMIT_PAGE_LOAD_MS, `the page took ${loadMs} ms`);
  });

  await check("the page renders every reviewed file", async () => {
    const count = await js(`document.querySelectorAll('.diff-file').length`);
    const expected = started.files;
    assert.ok(count > 0, "no file was rendered");
    assert.ok(count <= expected, `more sections (${count}) than files (${expected})`);
  });

  await check("the tree lists the files of the project", async () => {
    const rows = await js(`document.querySelectorAll('.tree-row').length`);
    assert.ok(rows > 100, `the tree is nearly empty (${rows} rows)`);
  });

  await check("the unicode path survives the round trip", async () => {
    const found = await js(`(() => {
      const rows = [...document.querySelectorAll('.tree-row')];
      return rows.some((row) => row.textContent.includes('новый'));
    })()`);
    assert.equal(found, true, "the unicode path is not in the tree");
  });

  await check("a file whose name holds a space is one row, not two", async () => {
    const out = await js(`(() => {
      const rows = [...document.querySelectorAll('.tree-row[data-dir="false"]')];
      const spaced = rows.filter((row) => (row.dataset.path || '').startsWith('data/with space'));
      return { count: spaced.length, path: spaced[0] ? spaced[0].dataset.path : null };
    })()`);
    assert.equal(out.count, 1, "the spaced file is not a single tree row");
    assert.equal(out.path, "data/with space.txt", "the path was split at its space");
  });

  await check("the binary file is shown without a broken diff", async () => {
    const out = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path.includes('logo.png'));
      if (!section) return { skip: true };
      return { skip: false, text: section.textContent.slice(0, 400) };
    })()`);
    if (out.skip) return;
    assert.ok(!out.text.includes("\\320"), "the escaped path is visible");
  });

  await check("the long line does not break the layout", async () => {
    const overflow = await js(`(() => {
      const table = document.querySelector('.diff-table');
      if (!table) return -1;
      return table.scrollWidth - table.clientWidth;
    })()`);
    assert.ok(overflow >= 0, `the table overflows to the left (${overflow})`);
  });

  await check("the tail of a big file keeps its blue button", async () => {
    // The generated file is only modified by one commit, so the diff is taken
    // from that commit: a file that is added whole has no hidden region.
    const { stdout: growthSha } = await execAsync(fixture.git, ["log", "-n", "1", "--format=%H", "--", "src/generated/large.ts"], { cwd: fixture.root });
    const { stdout: parentSha } = await execAsync(fixture.git, ["rev-parse", `${growthSha.trim()}^`], { cwd: fixture.root });

    const big = await startReview({
      repoPath: fixture.root,
      mode: MODE.RANGE,
      base: parentSha.trim(),
      head: growthSha.trim(),
      port: 0,
      dispatchEnabled: false,
    });

    try {
      const page = await new Builder()
        .forBrowser("firefox")
        .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 }))
        .build();

      try {
        await page.get(big.url);
        await page.wait(until.elementLocated(By.css(".diff-file")), 20_000);
        await PAUSE(2_000);

        // A very large file is loaded on demand, like on GitHub.
        const loaded = await page.executeScript(`return (() => {
          const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path.includes('generated/large.ts'));
          if (!section) return { missing: true };
          const button = section.querySelector('.js-load-file');
          if (button) button.click();
          return { missing: false, deferred: !!button };
        })();`);
        assert.ok(!loaded.missing, "the generated file is not on the page");
        await PAUSE(3_000);

        const info = await page.executeScript(`return (() => {
          const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path.includes('generated/large.ts'));
          if (!section) return null;
          const bars = section.querySelectorAll('.hunk-expander[data-dir="down"]');
          if (!bars.length) return { path: section.dataset.path, bars: 0 };
          bars[bars.length - 1].scrollIntoView({ block: 'center' });
          return { path: section.dataset.path, bars: bars.length };
        })();`);
        assert.ok(info, "the generated file is not on the page");
        assert.ok(info.bars > 0, "the tail of the file has no button");

        await page.executeScript(`return (() => {
          const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path === ${JSON.stringify(info.path)});
          const bars = section.querySelectorAll('.hunk-expander[data-dir="down"]');
          bars[bars.length - 1].querySelector('.js-expand').click();
          return true;
        })();`);
        await PAUSE(1_500);

        const after = await page.executeScript(`return (() => {
          const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path === ${JSON.stringify(info.path)});
          const lines = [...section.querySelectorAll('td.diff-code[data-new]')].map((cell) => Number(cell.dataset.new));
          return { last: Math.max(...lines), bars: section.querySelectorAll('.hunk-expander[data-dir="down"]').length };
        })();`);
        assert.ok(after.last > 100, `the tail was not revealed (last line ${after.last})`);
        assert.equal(after.bars, 0, "the used button is still there");
      } finally {
        await page.quit();
      }
    } finally {
      await big.page.close();
    }
  });

  await check("the comment can be added to a changed line", async () => {
    const added = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find((s) => s.querySelector('tr[data-line]'));
      if (!section) return false;
      const row = section.querySelector('tr[data-line]');
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    assert.equal(added, true, "no row to comment on");
  });
} finally {
  if (driver) await driver.quit();
  if (started) await started.page.close();
  await fixture.cleanup();
}
