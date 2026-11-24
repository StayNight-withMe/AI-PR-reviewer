
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { MODE, GIT } from "../src/config.js";

const exec = promisify(execFile);
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}


async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-defects-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await writeFile(join(root, "README.md"), "base\n");
  await git("add", "-A");
  await git("commit", "-m", "init");


  const csharp = [
    "namespace Demo;",
    "",
    "public class Widget",
    "{",
    "    public override string ToString() => \"widget\";",
    "    public override int GetHashCode() => 1;",
    "    public object Constructor() => new object();",
    "    public bool ValueOf() => true;",
    "    public bool HasOwnProperty() => false;",
    "    public void Run() { var x = ToString(); }",
    "}",
    "",
  ].join("\n");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "Widget.cs"), csharp);


  const go = [
    "package main",
    "",
    "import \"fmt\"",
    "",
    "func main() {",
    "\tfmt.Println(\"hello\")",
    "}",
    "",
  ].join("\n");
  await writeFile(join(root, "src", "main.go"), go);

  return { root, git };
}

const fixture = await createFixture();



const INHERITED_SESSION_ENV = ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"];
for (const name of INHERITED_SESSION_ENV) delete process.env[name];

const started = await startReview({
  repoPath: fixture.root,
  mode: MODE.UNCOMMITTED,
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
const waitFor = (code, timeout = 30000) => driver.wait(async () => {
  try { return await js(code); } catch { return false; }
}, timeout);

try {
  await driver.get(started.url);
  await waitFor(`document.body.dataset.booted === '1'`);
  await waitFor(`[...document.querySelectorAll('.diff-file')].every(s => s.dataset.hydrated === '1')`);

  await check("every section finishes hydrating", async () => {
    const state = await js(`(() => {
      const sections = [...document.querySelectorAll('.diff-file')];
      return {
        total: sections.length,
        hydrated: sections.filter(s => s.dataset.hydrated === '1').length,
        failed: sections.filter(s => s.dataset.highlightFailed === '1').length,
      };
    })()`);
    assert.equal(state.hydrated, state.total, `${state.total - state.hydrated} sections never loaded`);
    assert.equal(state.failed, 0, "a section reported a highlighting failure");
  });

  await check("a symbol named after an Object.prototype member does not break colouring", async () => {
    const state = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('.cs'));
      const cells = [...section.querySelectorAll('td.diff-code')];
      return {
        cells: cells.length,
        coloured: cells.filter(c => c.querySelectorAll('span').length > 0).length,
        keywords: section.querySelectorAll('.hljs-keyword').length,
      };
    })()`);
    assert.ok(state.cells > 5, "the C# file did not render");
    assert.ok(state.coloured > 5, `only ${state.coloured}/${state.cells} lines got colour`);
    assert.ok(state.keywords > 3, `expected C# keywords, found ${state.keywords}`);
  });

  await check("a Go file is highlighted, not left as plain white text", async () => {
    const state = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('.go'));
      const cells = [...section.querySelectorAll('td.diff-code')];
      return {
        cells: cells.length,
        coloured: cells.filter(c => c.querySelectorAll('span').length > 0).length,
        keywords: section.querySelectorAll('.hljs-keyword').length,
      };
    })()`);
    assert.ok(state.cells > 3, "the Go file did not render");
    assert.ok(state.coloured > 0, "the Go file has no highlighting at all");
    assert.ok(state.keywords > 0, "expected Go keywords, found none");
  });

  await check("Expand all opens every region and removes the blue button", async () => {
    const result = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.querySelector('.hunk-expander'));
      if (!section) return { skipped: true };
      const barsBefore = section.querySelectorAll('.hunk-expander').length;
      const rowsBefore = section.querySelectorAll('tr').length;

      section.querySelector('.js-file-menu').click();
      await new Promise(r => setTimeout(r, 30));
      const item = section.querySelector('.js-expand-all');
      if (!item) return { noItem: true, barsBefore };
      item.click();
      await new Promise(r => setTimeout(r, 500));

      return {
        barsBefore,
        barsAfter: section.querySelectorAll('.hunk-expander').length,
        rowsBefore,
        rowsAfter: section.querySelectorAll('tr').length,
        toasts: [...document.querySelectorAll('.toast.show')].map(t => t.textContent),
      };
    })()`);
    if (result.skipped) return;
    assert.ok(!result.noItem, "a file with hidden regions must offer Expand all");
    assert.ok(result.barsBefore > 0, "the fixture should have a hidden region");
    assert.equal(result.barsAfter, 0, "the blue expander is still on the page");
    assert.ok(result.rowsAfter > result.rowsBefore, "no rows were revealed");
    assert.deepEqual(result.toasts, [], "Expand all must not claim there is nothing below");
  });

  await check("the submit dialog offers both verdicts, a note and the send switch", async () => {
    const dialog = await js(`(() => {
      document.getElementById('btn-submit').click();
      const modal = document.getElementById('dispatch-modal');
      const verdicts = [...modal.querySelectorAll('input[name="review-verdict"]')].map(i => i.value);
      const result = {
        open: modal.classList.contains('show'),
        verdicts,
        defaultVerdict: (modal.querySelector('input[name="review-verdict"]:checked') || {}).value,
        hasNote: !!document.getElementById('review-body'),
        hasSend: !!document.getElementById('dispatch-send'),
        sendChecked: (document.getElementById('dispatch-send') || {}).checked,
        // A local review has no pull request, so it must not offer GitHub.
        hasPublish: !!document.getElementById('btn-publish-github'),
      };
      modal.querySelector('.js-close-modal').click();
      return result;
    })()`);
    assert.ok(dialog.open, "the dialog did not open");
    assert.deepEqual(dialog.verdicts.sort(), ["APPROVE", "REQUEST_CHANGES"]);
    assert.equal(dialog.defaultVerdict, "REQUEST_CHANGES");
    assert.ok(dialog.hasNote, "the note field is missing");
    assert.ok(dialog.hasSend, "the send switch is missing");
    assert.equal(dialog.hasPublish, false, "local reviews must not offer GitHub publication");
  });

  await check("an approval is refused when auto-send is off, and no turn starts", async () => {
    const result = await js(`(async () => {
      const saved = await fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reviewState: 'APPROVE',
          reviewBody: 'LGTM',
          comments: [],
          summary: { files: 1, additions: 1, deletions: 0, comments: 0 },
        }),
      }).then(r => r.json());
      const dispatched = await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonPath: saved.jsonPath,
          markdownPath: saved.markdownPath,
          review: { reviewState: 'APPROVE', reviewBody: 'LGTM', comments: [] },
        }),
      }).then(r => r.json());
      return {
        saved: saved.ok,
        dispatched: dispatched.ok,
        started: !!(dispatched.agent && dispatched.agent.started),
        reason: dispatched.reason || null,
      };
    })()`);
    assert.ok(result.saved, "the approval was not saved");
    assert.ok(result.dispatched, "the dispatch request failed");

    assert.equal(result.started, false, "a turn was started despite auto-send being off");
    assert.match(result.reason || "", /Auto-send is turned off/);
  });

  await check("the page offers both verdicts even with auto-send off", async () => {
    const dialog = await js(`(() => {
      document.getElementById('btn-submit').click();
      const modal = document.getElementById('dispatch-modal');
      const verdicts = [...modal.querySelectorAll('input[name="review-verdict"]')].map(i => i.value);
      modal.querySelector('.js-close-modal').click();
      return { verdicts };
    })()`);
    assert.deepEqual(dialog.verdicts.sort(), ["APPROVE", "REQUEST_CHANGES"]);
  });

  await check("the approve prompt tells the agent not to rewrite the code", async () => {
    const { buildDispatchPrompt } = await import("../src/dispatch.js");
    const prompt = buildDispatchPrompt(
      { reviewState: "APPROVE", reviewBody: "Nice", comments: [] },
      { repo: "r", branch: "b", mode: "branch", base: "a", head: "b" },
      { jsonPath: "j", markdownPath: "m" },
    );
    assert.match(prompt, /APPROVED/);
    assert.match(prompt, /Do not rewrite/);
    assert.doesNotMatch(prompt, /Start fixing the code now/);
  });

  await check("the approve prompt keeps a small note the reviewer added", async () => {
    const { buildDispatchPrompt } = await import("../src/dispatch.js");
    const prompt = buildDispatchPrompt(
      { reviewState: "APPROVE", reviewBody: "Rename that variable later", comments: [] },
      { repo: "r", branch: "b", mode: "branch" },
      { jsonPath: "j", markdownPath: "m" },
    );
    assert.match(prompt, /Rename that variable later/);

    assert.doesNotMatch(prompt, /without notes/);
    assert.match(prompt, /the note above is the only remark/);
  });

  await check("an approval with no note says so plainly", async () => {
    const { buildDispatchPrompt } = await import("../src/dispatch.js");
    const prompt = buildDispatchPrompt(
      { reviewState: "APPROVE", reviewBody: "   ", comments: [] },
      { repo: "r", branch: "b", mode: "branch" },
      { jsonPath: "j", markdownPath: "m" },
    );
    assert.match(prompt, /no note/);
  });

  await check("the note field accepts a pasted screenshot", async () => {
    const result = await js(`(async () => {
      document.getElementById('btn-submit').click();
      const modal = document.getElementById('dispatch-modal');
      const textarea = document.getElementById('review-body');
      const wrap = document.getElementById('review-note-wrap');
      const chips = document.getElementById('review-note-chips');
      if (!textarea || !wrap || !chips) return { missing: true };

      async function makeFile(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 6; canvas.height = 6;
        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        return new File([blob], name, { type: 'image/png' });
      }

      const wired = typeof PR.bindImageInput === 'function';

      // A real drag-and-drop of an image file onto the note.
      const dropped = await makeFile('dropped.png');
      const dropTransfer = new DataTransfer();
      dropTransfer.items.add(dropped);
      textarea.dispatchEvent(new DragEvent('drop', { dataTransfer: dropTransfer, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      const afterDrop = chips.querySelectorAll('.attach-chip').length;

      // A paste: browsers hand the handler a ClipboardData with the image on it.
      // A synthesised ClipboardEvent drops clipboardData in Firefox, so the
      // handler is given the same interface the real event carries.
      const pasted = await makeFile('pasted.png');
      const pasteTransfer = new DataTransfer();
      pasteTransfer.items.add(pasted);
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(pasteEvent, 'clipboardData', { value: pasteTransfer });
      textarea.dispatchEvent(pasteEvent);
      await new Promise(r => setTimeout(r, 400));
      const afterPaste = chips.querySelectorAll('.attach-chip').length;

      // Removing a chip must drop exactly that attachment.
      const removeButtons = chips.querySelectorAll('.attach-remove');
      if (removeButtons.length) removeButtons[0].click();
      await new Promise(r => setTimeout(r, 200));
      const afterRemove = chips.querySelectorAll('.attach-chip').length;

      const srcs = [...chips.querySelectorAll('.attach-chip img')].map(img => img.src.slice(0, 22));
      modal.querySelector('.js-close-modal').click();
      return { wired, afterDrop, afterPaste, afterRemove, srcs };
    })()`);
    assert.ok(!result.missing, "the note field has no attachment area");
    assert.ok(result.wired, "the image binder is not exposed to the dialog");
    assert.equal(result.afterDrop, 1, `a dropped screenshot did not attach: ${JSON.stringify(result)}`);
    assert.equal(result.afterPaste, 2, `a pasted screenshot did not attach: ${JSON.stringify(result)}`);
    assert.equal(result.afterRemove, 1, "removing a chip did not drop the attachment");
    assert.ok(result.srcs.every((src) => src.indexOf("data:image/") === 0), "an attachment is not the image itself");
  });

  await check("the Commits tab offers a branch selector", async () => {
    const branches = await js(`(async () => {
      document.querySelector('.gh-tab[data-tab="commits"]').click();
      for (let i = 0; i < 50; i += 1) {
        const sel = document.getElementById('branch-select');
        if (sel && sel.options.length > 0 && sel.options[0].textContent !== 'Loading branches…') break;
        await new Promise(r => setTimeout(r, 100));
      }
      const sel = document.getElementById('branch-select');
      return sel ? { options: [...sel.options].map(o => o.value), selected: sel.value } : null;
    })()`);
    assert.ok(branches, "the branch selector is missing");
    assert.ok(branches.options.length >= 1, "the selector has no branches");
    assert.equal(branches.selected, "main");
  });
} finally {
  await driver.quit();
  await started.page.close();
  await rm(fixture.root, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll review-defect checks passed");
