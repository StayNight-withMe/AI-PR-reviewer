/**
 * Regression suite for the reported review-UI bugs:
 * viewed/collapse, gutter drag selection, expand-all, eager highlighting,
 * symbol links, Last file, viewer hash navigation and viewer comments.
 */
import assert from "node:assert/strict";
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
const BASE = process.argv[2] ?? "http://127.0.0.1:5454/";
const SCRIPT_TIMEOUT = 30_000;
const PAUSE = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Target name a new browser tab is opened with. */
const TARGET_BLANK = "_blank";
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 }))
  .build();
const failures = [];
function check(name, fn) {
  return fn().then(
    () => console.log(`PASS ${name}`),
    (error) => {
      failures.push(`${name}: ${error.message}`);
      console.log(`FAIL ${name} — ${error.message}`);
    },
  );
}
async function js(code) {
  return driver.executeScript(`return (${code});`);
}
async function waitFor(code, timeout = SCRIPT_TIMEOUT) {
  return driver.wait(async () => {
    try { return await js(code); } catch { return false; }
  }, timeout);
}
try {
  console.log("BOOT loading page");
  await driver.get(BASE);
  console.log("BOOT page loaded");
  await waitFor(`document.querySelectorAll('.diff-file').length > 0 && [...document.querySelectorAll('.diff-file')].some(s => s.dataset.hydrated === '1')`);
  console.log("BOOT first section hydrated");
  await waitFor(`[...document.querySelectorAll('.diff-file')].filter(s => s.dataset.hydrated === '1').length >= Math.min(64, document.querySelectorAll('.diff-file').length)`);
  console.log("BOOT all sections hydrated");

  await check("all diff sections are highlighted and linkified", async () => {
    const stats = await js(`(() => {
      const sections = [...document.querySelectorAll('.diff-file')];
      const cs = sections.filter(s => s.dataset.path.endsWith('.cs'));
      const cells = cs.flatMap(s => [...s.querySelectorAll('td.diff-code:not(.cell-meta)')]);
      return {
        sections: sections.length,
        hydrated: sections.filter(s => s.dataset.hydrated === '1').length,
        csCells: cells.length,
        highlighted: cells.filter(c => c.dataset.highlighted === '1').length,
        keywords: cs.reduce((n, s) => n + s.querySelectorAll('.hljs-keyword').length, 0),
        links: document.querySelectorAll('.sym-link').length,
      };
    })()`);
    assert.ok(stats.hydrated === stats.sections, `hydrated ${stats.hydrated}/${stats.sections}`);
    assert.ok(stats.highlighted === stats.csCells, `highlighted ${stats.highlighted}/${stats.csCells}`);
    assert.ok(stats.keywords > 50, `expected syntax keywords, found ${stats.keywords}`);
    assert.ok(stats.links > 20, `expected symbol links, found ${stats.links}`);
  });

  await check("changed lines are tinted once, not twice", async () => {
    const stats = await js(`(() => {
      const add = document.querySelector('tr.row-add');
      const del = document.querySelector('tr.row-del');
      if (!add || !del) return null;

      const cell = add.querySelector('td.diff-code');
      const row = getComputedStyle(add).backgroundColor;
      const code = getComputedStyle(cell).backgroundColor;
      const gutter = getComputedStyle(add.querySelector('td.diff-gutter')).backgroundColor;

      return {
        row,
        code,
        gutter,
        delCode: getComputedStyle(del.querySelector('td.diff-code')).backgroundColor,
      };
    })()`);
    assert.ok(stats, "expected added and deleted rows");
    // A background on the <tr> would stack a second translucent layer on top of
    // the cells, which is what made the whole diff look tinted.
    assert.equal(stats.row, "rgba(0, 0, 0, 0)", `<tr> must stay transparent, got ${stats.row}`);
    assert.notEqual(stats.code, "rgba(0, 0, 0, 0)", "added cells need a tint");
    assert.notEqual(stats.delCode, "rgba(0, 0, 0, 0)", "deleted cells need a tint");
    assert.notEqual(stats.gutter, stats.code, "gutter uses the stronger tint");
  });

  await check("only method calls get an identifier colour", async () => {
    const stats = await js(`(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--fg)';
      document.body.appendChild(probe);
      const fg = getComputedStyle(probe).color;
      probe.remove();

      const calls = [...document.querySelectorAll('.sym-call')];
      const plain = [...document.querySelectorAll('.sym-link:not(.sym-call)')];
      return {
        fg,
        calls: calls.length,
        callsColoured: calls.filter(a => getComputedStyle(a).color !== fg).length,
        plain: plain.length,
        plainUncoloured: plain.filter(a => getComputedStyle(a).color === fg).length,
      };
    })()`);
    assert.ok(stats.calls > 0, "expected method calls");
    assert.ok(stats.callsColoured === stats.calls, "every call must be coloured");
    assert.ok(stats.plain > 0, "expected plain identifiers");
    assert.equal(stats.plainUncoloured, stats.plain,
      "types, class names and variables must keep the default text colour");
  });

  await check("using/namespace lines are not turned into false symbol links", async () => {
    const linked = await js(`(() => {
      const cells = [...document.querySelectorAll('td.diff-code')];
      return cells.filter(c => /^\\s*(using|namespace)\\b/.test(c.textContent) && c.querySelector('.sym-link')).length;
    })()`);
    assert.equal(linked, 0);
  });

  await check("Viewed collapses, chevron expands the same content again", async () => {
    const result = await js(`(async () => {
      const section = document.querySelector('.diff-file');
      const before = section.querySelectorAll('td.diff-code').length;

      section.querySelector('.viewed-wrap').click();
      const animating = section.querySelector('.diff-body').style.height !== '';
      await new Promise(r => setTimeout(r, PR.UI.VIEWED_ANIM_MS + 120));

      const collapsed = section.classList.contains('collapsed');
      const keptRows = section.querySelectorAll('td.diff-code').length;

      section.querySelector('.js-collapse').click();
      const expanded = !section.classList.contains('collapsed');
      const bodyVisible = section.querySelector('.diff-body').getBoundingClientRect().height > 0;
      return { before, animating, collapsed, keptRows, expanded, bodyVisible, after: section.querySelectorAll('td.diff-code').length };
    })()`);
    assert.ok(result.animating, "Viewed must animate the body height");
    assert.ok(result.collapsed, "expected the file to collapse after Viewed");
    assert.equal(result.keptRows, result.before, "Viewed must not delete the diff body");
    assert.ok(result.expanded, "chevron did not expand the file");
    assert.ok(result.bodyVisible, "body is still hidden after expanding");
    assert.equal(result.after, result.before);
  });

  await check("Expand all reveals the whole file", async () => {
    const path = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path.endsWith('.cs') && s.querySelectorAll('.diff-hunk').length > 1);
      section.scrollIntoView({block:'center'});
      return section.dataset.path;
    })()`);
    const before = await js(`document.querySelector('section[data-path="' + CSS.escape(${JSON.stringify(path)}) + '"]').querySelectorAll('td.diff-code').length`);
    await js(`document.querySelector('section[data-path="' + CSS.escape(${JSON.stringify(path)}) + '"] .js-expand-all').click()`);
    await PAUSE(1200);
    const after = await js(`document.querySelector('section[data-path="' + CSS.escape(${JSON.stringify(path)}) + '"]').querySelectorAll('td.diff-code').length`);
    assert.ok(after > before, `expected more visible lines after Expand all (${before} -> ${after})`);
    assert.ok(after >= 20, `expected a full file, got ${after} lines`);
  });

  await check("hunk gaps use a wide expander over the number columns", async () => {
    const stats = await js(`(() => {
      const bars = [...document.querySelectorAll('.hunk-expander')];
      if (!bars.length) return { bars: 0 };
      const bar = bars[0];
      const cell = bar.querySelector('.expander-cell');
      const button = bar.querySelector('.js-expand');
      const table = bar.closest('.diff-file').querySelector('.diff-table');
      const codeCell = table.querySelector('td.diff-code') ||
        table.querySelector('td:last-child');
      return {
        bars: bars.length,
        cellWidth: Math.round(cell.getBoundingClientRect().width),
        codeWidth: codeCell ? Math.round(codeCell.getBoundingClientRect().width) : 0,
        hasButton: !!button,
        hasSvg: !!bar.querySelector('.hunk-expander-svg'),
        noHeader: !bar.closest('.diff-file').querySelector('.diff-hunk-header'),
        height: Math.round(bar.getBoundingClientRect().height),
        blue: getComputedStyle(cell).backgroundColor !== 'rgba(0, 0, 0, 0)',
        fullWidth: Math.abs(button.getBoundingClientRect().width - cell.getBoundingClientRect().width) < 2,
      };
    })()`);
    assert.ok(stats.bars > 0, "expected gap expanders");
    assert.ok(stats.hasButton && stats.hasSvg, "expander needs its arrow button");
    assert.ok(stats.noHeader, "the @@ hunk header line must be gone");
    // Covers the gutter plus both number columns, never the code.
    assert.ok(stats.cellWidth >= 80, `expander must span the number columns, got ${stats.cellWidth}px`);
    assert.ok(stats.cellWidth < stats.codeWidth, "expander must not cover the code column");
    assert.ok(stats.fullWidth, "the button must fill its whole cell");
    assert.ok(stats.height >= 16 && stats.height <= 40, `unexpected bar height ${stats.height}`);
    assert.ok(stats.blue, "the gap control must use GitHub's blue highlight");
  });

  await check("expander reveals the hidden lines and disappears", async () => {
    const info = await js(`(() => {
      const bar = document.querySelector('.hunk-expander');
      if (!bar) return null;
      bar.scrollIntoView({block:'center'});
      return { path: bar.closest('.diff-file').dataset.path, dir: bar.dataset.dir };
    })()`);
    assert.ok(info, "expected a gap expander");

    const before = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      return section.querySelectorAll('td.diff-code').length;
    })()`);
    await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      section.querySelector('.hunk-expander[data-dir="${info.dir}"] .js-expand').click();
      return true;
    })()`);
    await PAUSE(1200);
    const after = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      return {
        cells: section.querySelectorAll('td.diff-code').length,
        barsLeft: section.querySelectorAll('.hunk-expander[data-dir="${info.dir}"]').length,
      };
    })()`);
    assert.ok(after.cells > before, `expected more lines (${before} -> ${after.cells})`);
    assert.equal(after.barsLeft, 0, "the used bar must disappear");
  });

  await check("the tail of a file keeps its expander", async () => {
    // Strict folding: every hidden region gets a button, so the tail of a
    // file can be checked on its own.
    await js(`(PR.state.settings.contextCollapseLines = 1, PR.renderFileList(), true)`);
    await PAUSE(1500);

    const info = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.querySelector('.hunk-expander[data-dir="down"]'));
      if (!section) return null;
      section.scrollIntoView({ block: 'center' });
      const hunks = section.querySelectorAll('.diff-hunk');
      const hunk = hunks[hunks.length - 1];
      const lastShown = [...hunk.querySelectorAll('td.diff-code[data-new]')].pop();
      return { path: section.dataset.path, lastShown: lastShown ? Number(lastShown.dataset.new) : 0 };
    })()`);
    assert.ok(info, "a file with a hidden tail must show the blue button");

    await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      section.querySelector('.hunk-expander[data-dir="down"] .js-expand').click();
      return true;
    })()`);
    await PAUSE(1500);

    const after = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      const lines = [...section.querySelectorAll('td.diff-code[data-new]')].map(c => Number(c.dataset.new));
      return {
        last: Math.max(...lines),
        barsLeft: section.querySelectorAll('.hunk-expander[data-dir="down"]').length,
      };
    })()`);
    assert.ok(after.last > info.lastShown, `the tail must be revealed (${info.lastShown} -> ${after.last})`);
    assert.equal(after.barsLeft, 0, "the used bar must disappear");
  });

  await check("small regions are shown without a button", async () => {
    await js(`(PR.state.settings.contextCollapseLines = 1000, PR.renderFileList(), true)`);
    await PAUSE(2000);

    const out = await js(`(() => ({
      bars: document.querySelectorAll('.hunk-expander').length,
      rows: document.querySelectorAll('.row-ctx').length,
    }))()`);
    assert.equal(out.bars, 0, "no region may stay hidden behind a button");
    assert.ok(out.rows > 100, `the unchanged lines must be shown, got ${out.rows}`);
  });

  await check("folding can be switched off completely", async () => {
    await js(`(PR.state.settings.contextCollapseLines = 0, PR.renderFileList(), true)`);
    await PAUSE(2000);

    const out = await js(`(() => ({
      bars: document.querySelectorAll('.hunk-expander').length,
      files: document.querySelectorAll('.diff-file').length,
      rows: document.querySelectorAll('.row-ctx').length,
    }))()`);
    assert.equal(out.bars, 0, "nothing may be hidden when folding is off");
    assert.ok(out.rows > 100, `the unchanged lines must be shown, got ${out.rows}`);

    // Back to the default for the remaining checks.
    await js(`(PR.state.settings.contextCollapseLines = PR.CONTEXT.DEFAULT_COLLAPSE_LINES, PR.renderFileList(), true)`);
    await PAUSE(1500);
  });

  await check("Expand all reveals every line exactly once", async () => {
    await js(`(PR.state.settings.contextCollapseLines = 1, PR.renderFileList(), true)`);
    await PAUSE(1500);

    await js(`(document.querySelectorAll('.diff-file .js-expand-all').forEach(b => b.click()), true)`);
    await PAUSE(3000);

    const out = await js(`(() => {
      const bad = [];
      for (const section of document.querySelectorAll('.diff-file')) {
        const lines = [...section.querySelectorAll('td.diff-code[data-new]')].map(c => c.dataset.new).filter(Boolean);
        const dupes = [...new Set(lines.filter((l, i) => lines.indexOf(l) !== i))];
        if (dupes.length) bad.push({ path: section.dataset.path, dupes: dupes.slice(0, 5) });
      }
      return { bad: bad.slice(0, 3), count: bad.length, bars: document.querySelectorAll('.hunk-expander').length };
    })()`);
    assert.equal(out.count, 0, `lines must not be duplicated: ${JSON.stringify(out.bad)}`);
    assert.equal(out.bars, 0, "every region must be open after Expand all");

    await js(`(PR.state.settings.contextCollapseLines = PR.CONTEXT.DEFAULT_COLLAPSE_LINES, PR.renderFileList(), true)`);
    await PAUSE(1500);
  });

  await check("View file opens in a new tab by default", async () => {
    const out = await js(`(() => {
      PR.state.settings.viewFileMode = PR.VIEW_FILE_MODE.TAB;
      const calls = [];
      const original = window.open;
      window.open = (href, target) => { calls.push({ href: String(href), target: String(target) }); return null; };
      const section = [...document.querySelectorAll('.diff-file')][0];
      const link = section.querySelector('.js-open-file');
      link.click();
      window.open = original;
      return { calls, href: link.getAttribute('href') };
    })()`);
    assert.equal(out.calls.length, 1, "the file must open in a new tab");
    assert.ok(out.calls[0].href.includes("/file?path="), `unexpected url ${out.calls[0].href}`);
    assert.equal(out.calls[0].target, TARGET_BLANK);
  });

  await check("View file can open in an embedded panel", async () => {
    const out = await js(`(async () => {
      PR.state.settings.viewFileMode = PR.VIEW_FILE_MODE.PANEL;
      const section = [...document.querySelectorAll('.diff-file')][0];
      const path = section.dataset.path;
      section.querySelector('.js-open-file').click();
      await new Promise(r => setTimeout(r, 2500));
      const host = document.getElementById('inline-file-host');
      const opened = host ? host.querySelector('.diff-file') : null;
      return { path, opened: opened ? opened.dataset.path : null, hidden: host ? host.classList.contains('hidden') : true };
    })()`);
    assert.equal(out.opened, out.path, "the file must render inside the review");
    assert.ok(!out.hidden, "the embedded panel must be visible");
    await js(`(PR.closeInlineFile(), true)`);
  });

  await check("View file can stay on this page", async () => {
    const out = await js(`(async () => {
      PR.state.settings.viewFileMode = PR.VIEW_FILE_MODE.SAME;
      const section = [...document.querySelectorAll('.diff-file')][0];
      const before = location.href;
      section.querySelector('.js-open-file').click();
      await new Promise(r => setTimeout(r, 800));
      return { before, after: location.href, scrolled: window.scrollY >= 0 };
    })()`);
    assert.equal(out.after, out.before, "the review must not navigate away");
  });

  await check("modified lines highlight only the changed characters", async () => {
    const stats = await js(`(() => {
      const cells = [...document.querySelectorAll('td.diff-code[data-wm-start]')];
      if (!cells.length) return { cells: 0 };
      const cell = cells[0];
      const text = cell.textContent;
      const mark = cell.querySelector('.wm');
      const marked = cells.filter(c => c.querySelector('.wm')).length;
      const bg = mark ? getComputedStyle(mark).backgroundColor : null;
      return {
        cells: cells.length,
        marked: marked,
        markText: mark ? mark.textContent : null,
        text: text,
        narrower: mark ? mark.textContent.length < text.length : false,
        bg: bg,
        overflow: cell.scrollWidth > cell.clientWidth + 4,
      };
    })()`);
    assert.ok(stats.cells > 0, "expected paired changed lines");
    assert.ok(stats.marked > 0, "expected an intra-line mark");
    assert.ok(stats.narrower, `mark should cover only part of the line: ${stats.markText} vs ${stats.text}`);
    assert.ok(stats.bg && stats.bg !== "rgba(0, 0, 0, 0)", "marked characters need a background");
    assert.ok(!stats.overflow, "word marks must not change line width");
  });

  await check("drag selection starts on the + gutter", async () => {
    const info = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.querySelectorAll('.js-comment').length > 6);
      section.scrollIntoView({block:'center'});
      return { path: section.dataset.path };
    })()`);
    await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      const plus = section.querySelectorAll('.js-comment');
      plus[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      plus[4].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return true;
    })()`);
    await PAUSE(400);
    const selected = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(info.path)});
      return {
        selectedRows: section.querySelectorAll('.row-selected').length,
        editor: !!section.querySelector('.js-editor'),
        selection: PR.state.selection && { start: PR.state.selection.start, end: PR.state.selection.end },
      };
    })()`);
    assert.ok(selected.selectedRows >= 2, `expected a multiline selection, got ${selected.selectedRows}`);
    assert.ok(selected.editor, "expected the comment editor after the drag");
    assert.ok(selected.selection.end > selected.selection.start, "expected a line range");
    await js(`(PR.closeCommentForms(), PR.clearSelection(), true)`);
  });

  // A click on a symbol now always opens the usage menu first; the navigation
  // happens from a chosen entry inside it.
  await check("Ctrl+click and middle-click open a file in a new tab", async () => {
    const out = await js(`(() => {
      const opened = [];
      const realOpen = window.open;
      let fakeTab = null;
      window.open = (url, target, features) => {
        opened.push({ url: String(url), target, features: features || null });
        fakeTab = { focusCount: 0, opener: window, focus() { this.focusCount += 1; } };
        return fakeTab;
      };

      const row = [...document.querySelectorAll('.tree-row[data-dir="false"]')][3];
      const href = row.getAttribute('href');

      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      const afterCtrl = opened.length;
      const ctrlTab = fakeTab;

      const plainBefore = opened.length;
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const plainOpened = opened.length - plainBefore;

      row.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      const afterMiddle = opened.length - afterCtrl;

      const link = document.querySelector('.sym-link');
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      const afterSymbol = opened.length - afterCtrl - afterMiddle;

      const result = {
        opened,
        afterCtrl,
        plainOpened,
        afterMiddle,
        afterSymbol,
        onPage: location.pathname,
        ctrlFocusCount: ctrlTab ? ctrlTab.focusCount : 0,
        ctrlOpenerCleared: ctrlTab ? ctrlTab.opener === null : false,
        ctrlFeatures: opened[0] ? opened[0].features : null,
      };
      window.open = realOpen;
      return result;
    })()`);

    assert.equal(out.afterCtrl, 1, "Ctrl+click on a tree row must open a new tab");
    assert.equal(out.plainOpened, 0, "a plain click must stay in the review");
    assert.equal(out.afterMiddle, 1, "middle-click must open a new tab");
    assert.equal(out.afterSymbol, 1, "Ctrl+click on a symbol link must open a new tab");
    assert.equal(out.onPage, "/", "the review page must not navigate");
    // "noopener" made window.open return null, so the tab could never be focused.
    assert.equal(out.ctrlFeatures, null, "noopener must not be passed as a feature");
    assert.ok(out.ctrlFocusCount >= 1, "the new tab must be focused");
    assert.ok(out.ctrlOpenerCleared, "the opener must be detached after focusing");
    out.opened.forEach((call) => assert.ok(call.url.startsWith("/file?path="), `unexpected url ${call.url}`));
  });

  await check("symbol click opens the usage menu instead of jumping", async () => {
    const out = await js(`(async () => {
      const link = [...document.querySelectorAll('.sym-link')][0];
      const before = location.href;
      link.scrollIntoView({ block: 'center' });
      link.click();
      await new Promise(r => setTimeout(r, 1200));

      const pop = document.getElementById('sym-pop');
      return {
        samePage: location.href === before,
        hasPopover: !!pop,
        uses: pop ? pop.querySelectorAll('.sym-use').length : 0,
        hasDefinition: pop ? !!pop.querySelector('.sym-def') : false,
      };
    })()`);
    assert.ok(out.samePage, "clicking a symbol must not navigate away");
    assert.ok(out.hasPopover, "the usage menu must appear");
    assert.ok(out.uses > 0, "the menu must list usage sites");
    assert.ok(out.hasDefinition, "the menu must list the definition");
  });

  await check("choosing a usage in the menu opens it inside the page", async () => {
    const out = await js(`(async () => {
      const pop = document.getElementById('sym-pop');
      if (!pop) return { skip: true };
      const entry = pop.querySelector('.sym-use') || pop.querySelector('.sym-def');
      const path = new URL(entry.getAttribute('href'), location.origin).searchParams.get('path');
      const before = location.href;

      entry.click();
      await new Promise(r => setTimeout(r, 2500));

      const host = document.getElementById('inline-file-host');
      const section = host ? host.querySelector('.diff-file') : null;
      return {
        skip: false,
        path,
        samePage: location.href === before,
        popoverClosed: !document.getElementById('sym-pop'),
        inlinePath: section ? section.dataset.path : null,
        scrolled: window.scrollY > 0,
      };
    })()`);
    if (out.skip) return;

    assert.ok(out.samePage, "picking a usage must not leave the review");
    assert.ok(out.popoverClosed, "the menu must close after the choice");
    assert.ok(out.inlinePath, "the chosen file must render inline");
    assert.ok(out.scrolled, "the page must scroll to the opened target");
    await js(`(PR.closeInlineFile(), true)`);
  });

  await check("symbol popover lists definition + usage links with line anchors", async () => {
    await js(`(PR.state.settings.openLinksInline = false, true)`);
    const clicked = await js(`(() => {
      const links = [...document.querySelectorAll('.sym-link')];
      const link = links.find(a => a.dataset.name === 'IHasUpdatedAt')
        || links.find(a => !/^\\s*(using|namespace)/.test(a.closest('td').textContent));
      link.scrollIntoView({ block: 'center' });
      link.click();
      return link.dataset.name;
    })()`);
    await waitFor(`!!document.querySelector('.sym-pop .sym-use')`);
    const pop = await js(`(() => {
      const p = document.querySelector('.sym-pop');
      return {
        head: p.querySelector('.sym-pop-head').textContent,
        def: p.querySelector('.sym-def') ? p.querySelector('.sym-def').getAttribute('href') : null,
        uses: [...p.querySelectorAll('.sym-use')].map(a => a.getAttribute('href')),
      };
    })()`);
    assert.ok(pop.head.includes(clicked), "popover is for the clicked symbol");
    assert.ok(pop.uses.length > 0, "expected usage links");
    assert.ok(pop.uses.some((href) => /#L\d+$/.test(href)), `expected a line anchor in ${pop.uses.slice(0, 3).join(', ')}`);
  });

  await check("symbol popover shows full paths without ellipsis", async () => {
    const full = await js(`(() => {
      const pop = document.querySelector('.sym-pop');
      const paths = [...pop.querySelectorAll('.sym-path')];
      return paths.map(p => ({
        text: p.textContent,
        truncated: p.scrollWidth > p.clientWidth + 1,
        clipped: getComputedStyle(p).textOverflow === 'ellipsis',
        height: p.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(p).lineHeight) || 16,
      }));
    })()`);
    assert.ok(full.length > 0, "expected path entries in the popover");
    full.forEach(item => {
      assert.ok(!item.clipped, `path still uses ellipsis: ${item.text}`);
      assert.ok(!item.truncated, `path is cut off: ${item.text}`);
    });
    await js(`(PR.hideSymbolPopover(), true)`);
    await js(`(PR.state.settings.openLinksInline = true, true)`);
  });

  await check("Un-viewing a file expands it again", async () => {
    const result = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => !s.classList.contains('collapsed'));
      const path = section.dataset.path;

      PR.state.viewed.delete(path);
      PR.state.collapsed.delete(path);
      section.classList.remove('collapsed', 'is-viewed');
      PR.state.settings.collapseViewed = true;

      PR.toggleViewed(path);           // mark viewed -> height animation
      const animating = section.querySelector('.diff-body').style.height !== '';
      await new Promise(r => setTimeout(r, PR.UI.VIEWED_ANIM_MS + 120));
      const collapsed = section.classList.contains('collapsed');

      PR.toggleViewed(path);           // unmark -> must expand
      const expanded = !section.classList.contains('collapsed');
      return { animating, collapsed, expanded, stored: PR.state.collapsed.has(path) };
    })()`);
    assert.ok(result.animating, "Viewed must animate the body height");
    assert.ok(result.collapsed, "Viewed should collapse the file after the animation");
    assert.ok(result.expanded, "un-viewing must expand the file again");
    assert.ok(!result.stored, "the collapse flag must be cleared");
  });

  await check("A re-render during the Viewed animation keeps the file collapsed", async () => {
    // The collapse state was written inside the 160 ms animation timer,
    // so any re-render in that window (a storage event from the viewer tab, a
    // filter keystroke, a settings change) rebuilt the list from the state and
    // drew the file open again — it looked like marking another file Viewed
    // reopened this one.
    const result = await js(`(async () => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => !s.classList.contains('collapsed'));
      const path = section.dataset.path;

      PR.state.viewed.delete(path);
      PR.state.collapsed.delete(path);
      section.classList.remove('collapsed', 'is-viewed');
      PR.state.settings.collapseViewed = true;

      PR.toggleViewed(path);
      // Rebuild the whole list while the collapse animation is still running.
      PR.renderFileList();

      const fresh = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === path);
      const collapsedImmediately = PR.state.collapsed.has(path) && fresh.classList.contains('collapsed');

      await new Promise(r => setTimeout(r, PR.UI.VIEWED_ANIM_MS + 120));
      const settled = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === path);
      const stillCollapsed = PR.state.collapsed.has(path) && settled.classList.contains('collapsed');

      // Leave the page as it was.
      PR.toggleViewed(path);
      return { collapsedImmediately, stillCollapsed };
    })()`);
    assert.ok(result.collapsedImmediately, "the collapse flag must be set before the animation ends");
    assert.ok(result.stillCollapsed, "a re-render must not reopen a viewed file");
  });

  await check("Hide viewed is a real toggle with a visible state", async () => {
    const result = await js(`(() => {
      const btn = document.getElementById('toggle-viewed');
      const before = { pressed: btn.getAttribute('aria-pressed'), label: btn.textContent };
      btn.click();
      const after = { pressed: btn.getAttribute('aria-pressed'), label: btn.textContent };
      btn.click();
      const back = { pressed: btn.getAttribute('aria-pressed'), label: btn.textContent };
      return { before, after, back };
    })()`);
    assert.equal(result.before.pressed, "false");
    assert.equal(result.after.pressed, "true");
    assert.notEqual(result.after.label, result.before.label, "the label must reflect the state");
    assert.equal(result.back.pressed, "false");
  });

  await check("the review sidebar can be hidden", async () => {
    const result = await js(`(() => {
      const button = document.getElementById('btn-sidebar');
      const visibleBefore = getComputedStyle(document.getElementById('sidebar')).display !== 'none';
      button.click();
      const hiddenAfter = getComputedStyle(document.getElementById('sidebar')).display === 'none';
      button.click();
      const visibleAgain = getComputedStyle(document.getElementById('sidebar')).display !== 'none';
      return { visibleBefore, hiddenAfter, visibleAgain, persisted: PR.state.settings.showSidebar };
    })()`);
    assert.ok(result.visibleBefore, "sidebar should start visible");
    assert.ok(result.hiddenAfter, "sidebar should hide on toggle");
    assert.ok(result.visibleAgain, "sidebar should come back");
    assert.ok(result.persisted, "visibility must persist in settings");
  });

  await check("project search finds files and links to a line", async () => {
    const result = await js(`(() => {
      document.getElementById('btn-search').click();
      const input = document.getElementById('search-input');
      input.value = 'EnumNames';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    assert.ok(result);

    let hits = [];
    for (let attempt = 0; attempt < 40; attempt += 1) {
      hits = await js(`[...document.querySelectorAll('.search-hit')].map(a => a.getAttribute('href'))`);
      if (hits.length) break;
      await PAUSE(150);
    }
    assert.ok(hits.length > 0, "expected search hits");
    assert.ok(hits.every((href) => href.startsWith("/file?path=") && /#L\d+$/.test(href)), `bad hrefs: ${hits.slice(0, 3).join(', ')}`);
    await js(`(PR.closeSearch(), true)`);
  });

  await check("pushed commits are locked until explicitly unlocked", async () => {
    await js(`document.querySelector(".gh-tab[data-tab='commits']").click()`);
    await PAUSE(600);

    const before = await js(`(() => {
      const item = document.querySelector('.commit-item.is-pushed');
      if (!item) return null;
      return {
        disabled: !!item.querySelector('.commit-rename[disabled]'),
        unlocked: !!item.querySelector('.commit-unlock input').checked,
      };
    })()`);
    assert.ok(before, "expected at least one pushed commit in this repository");
    assert.ok(before.disabled, "a pushed commit must start locked");
    assert.ok(!before.unlocked, "the unlock box must start unticked");

    const after = await js(`(() => {
      const item = document.querySelector('.commit-item.is-pushed');
      item.querySelector('.commit-unlock input').click();
      const again = document.querySelector('.commit-item.is-pushed');
      return {
        disabled: !!again.querySelector('.commit-rename[disabled]'),
        unlocked: again.querySelector('.commit-unlock input').checked,
      };
    })()`);
    assert.ok(after.unlocked, "ticking the box must unlock the commit");
    assert.ok(!after.disabled, "Rename must become available after unlocking");
    await js(`document.querySelector(".gh-tab[data-tab='files']").click()`);
  });

  await check("gutter shows - for deleted lines and + for added lines", async () => {
    const stats = await js(`(() => {
      const signs = [...document.querySelectorAll('.gutter-sign')];
      const count = (sign) => signs.filter(s => s.textContent === sign).length;
      const delRow = document.querySelector('tr.row-del .gutter-sign');
      const addRow = document.querySelector('tr.row-add .gutter-sign');
      const gutterOf = (signEl) => signEl ? signEl.closest('td.diff-gutter') : null;
      const delGutter = gutterOf(delRow);
      const addGutter = gutterOf(addRow);
      return {
        total: signs.length,
        plus: count('+'),
        minus: count('\\u2212'),
        delSign: delRow ? delRow.textContent : null,
        addSign: addRow ? addRow.textContent : null,
        ctxSign: document.querySelector('tr.row-ctx .gutter-sign').textContent,
        delColor: delRow ? getComputedStyle(delRow).color : null,
        addColor: addRow ? getComputedStyle(addRow).color : null,
        delSignBg: delGutter ? getComputedStyle(delGutter).backgroundColor : null,
        addSignBg: addGutter ? getComputedStyle(addGutter).backgroundColor : null,
      };
    })()`);
    assert.ok(stats.plus > 0 && stats.minus > 0, `expected both signs (${stats.plus}/${stats.minus})`);
    assert.equal(stats.delSign, "\u2212", "deleted lines must show a minus");
    assert.equal(stats.addSign, "+", "added lines must show a plus");
    assert.equal(stats.ctxSign, "", "context lines must show no sign");
    // The sign must contrast with its own gutter tint, not match it: a red `-`
    // on the red background was invisible.
    assert.notEqual(stats.delColor, stats.delSignBg, "the minus must not blend into the deleted tint");
    assert.notEqual(stats.addColor, stats.addSignBg, "the plus must not blend into the added tint");
  });

  await check("the tree highlights the active file and keeps it after a click", async () => {
    const clicked = await js(`(async () => {
      const row = [...document.querySelectorAll('.tree-row[data-dir="false"]')]
        .find(r => r.classList.contains('status-modified'));
      row.scrollIntoView({ block: 'center' });
      row.click();
      // The click pins the highlight; it must survive the smooth scroll that the
      // navigation itself starts, and only a real user gesture releases it.
      await new Promise(r => setTimeout(r, 1600));
      return row.dataset.path;
    })()`);
    await PAUSE(900);

    const result = await js(`(() => {
      const active = [...document.querySelectorAll('.tree-row.is-active')];
      const row = [...document.querySelectorAll('.tree-row[data-dir="false"]')]
        .find(r => r.dataset.path === ${JSON.stringify(clicked)});
      return {
        count: active.length,
        path: active[0] ? active[0].dataset.path : null,
        sameRow: !!row && row.classList.contains('is-active'),
        shadow: row ? getComputedStyle(row).boxShadow : null,
      };
    })()`);
    assert.equal(result.count, 1, "exactly one tree row may be active");
    assert.equal(result.path, clicked, "the clicked file must be the active one");
    assert.ok(result.sameRow, "the active class must survive the click");
    assert.ok(result.shadow && result.shadow !== "none", "the active row needs a visible marker");
  });

  await check("the tree can be resized, collapsed and restored", async () => {
    const result = await js(`(async () => {
      const layout = document.querySelector('.gh-layout');
      const handle = document.getElementById('tree-resizer');
      const reveal = document.getElementById('tree-reveal');
      const nextFrame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const startWidth = PR.state.settings.treeWidth;
      const start = handle.getBoundingClientRect();

      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: start.left + 3 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: start.left + 140 }));
      await nextFrame();   // resize is throttled to one update per frame
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      const widened = PR.state.settings.treeWidth;

      const after = handle.getBoundingClientRect();
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: after.left + 3 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10 }));
      await nextFrame();
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      const collapsed = layout.classList.contains('tree-hidden');
      const revealVisible = !reveal.hidden && reveal.getBoundingClientRect().width > 0;
      const widthKept = PR.state.settings.treeWidth;

      reveal.click();
      const restored = !layout.classList.contains('tree-hidden') &&
        getComputedStyle(document.getElementById('file-tree')).display !== 'none' &&
        document.querySelector('.gh-main').getBoundingClientRect().left > 0;

      PR.setTreeWidth(320);

      return { startWidth, widened, collapsed, revealVisible, widthKept, restored, final: PR.state.settings.treeWidth };
    })()`);

    assert.ok(result.widened > result.startWidth, `dragging right must widen (${result.startWidth} -> ${result.widened})`);
    assert.ok(result.collapsed, "dragging past the minimum must collapse the tree");
    assert.ok(result.revealVisible, "a restore chevron must appear");
    assert.equal(result.widthKept, result.widened, "collapsing must remember the width");
    assert.ok(result.restored, "the chevron must bring the tree back without breaking the layout");
    assert.equal(result.final, 320, "reset to the default width");
  });

  await check("a file with no deletions hides the old line-number column", async () => {
    const stats = await js(`(() => {
      const tables = [...document.querySelectorAll('.diff-table.no-old-side')];
      if (!tables.length) return { tables: 0 };
      const table = tables[0];
      const cols = table.querySelectorAll('col').length;
      const hasLeft = !!table.querySelector('td.diff-num[data-side="left"]');
      const content = table.querySelector('td.diff-code');
      return {
        tables: tables.length,
        cols,
        hasLeft,
        contentWidth: content ? Math.round(content.getBoundingClientRect().width) : 0,
        tableWidth: Math.round(table.getBoundingClientRect().width),
      };
    })()`);
    assert.ok(stats.tables > 0, "expected at least one all-additions file");
    assert.equal(stats.cols, 3, "gutter + one number column + code");
    assert.ok(!stats.hasLeft, "no old-side number cell may remain");
    assert.ok(stats.contentWidth > stats.tableWidth * 0.8, "code should take the freed width");
  });

  await check("opening an unchanged file stays inside the review", async () => {
    const out = await js(`(async () => {
      const row = [...document.querySelectorAll('.tree-row[data-dir="false"]')]
        .find(r => !PR.state.changedPaths.has(r.dataset.path));
      if (!row) return { skip: true };

      const path = row.dataset.path;
      row.click();
      await new Promise(r => setTimeout(r, 2500));

      const host = document.getElementById('inline-file-host');
      const section = host ? host.querySelector('.diff-file') : null;
      return {
        skip: false,
        path,
        samePage: location.pathname === '/',
        visible: host ? !host.classList.contains('hidden') : false,
        rows: section ? section.querySelectorAll('td.diff-code').length : 0,
        highlighted: section ? section.querySelectorAll('td.diff-code[data-highlighted="1"]').length : 0,
      };
    })()`);

    if (out.skip) return;
    assert.ok(out.samePage, "must not navigate away from the review");
    assert.ok(out.visible, "the inline host must be shown");
    assert.ok(out.rows > 0, "the file content must render");
    assert.ok(out.highlighted > 0, "the inline file must be highlighted");
    await js(`(PR.closeInlineFile(), true)`);
  });

  await check("the tree reveals and scrolls to a file inside a folded folder", async () => {
    const out = await js(`(async () => {
      document.querySelectorAll('.tree-children').forEach(c => c.classList.add('hidden'));
      document.querySelectorAll('.tree-chevron').forEach(c => c.classList.add('collapsed'));

      const target = PR.state.files[Math.min(25, PR.state.files.length - 1)].path;
      PR.pinActiveTreeFile(target);
      await new Promise(r => setTimeout(r, 1500));
      PR.releaseTreePin();

      return {
        target,
        row: document.querySelector('.tree-row.is-active') || null,
      };
    })()`);

    const info = await js(`(() => {
      const row = document.querySelector('.tree-row.is-active');
      const pane = PR.els.tree;
      const rr = row ? row.getBoundingClientRect() : null;
      const pr = pane.getBoundingClientRect();
      return {
        found: !!row,
        path: row ? row.dataset.path : null,
        inView: rr ? (rr.top >= pr.top - 5 && rr.bottom <= pr.bottom + 5) : false,
      };
    })()`);

    assert.ok(info.found, "the active row must be rendered");
    assert.equal(info.path, out.target);
    assert.ok(info.inView, "the tree must scroll the active row into view");
  });

  await check("a large file is collapsed behind a Load button", async () => {
    const info = await js(`(() => {
      const deferred = [...document.querySelectorAll('.diff-file.is-deferred')];
      return {
        count: deferred.length,
        limit: PR.state.settings.largeFileLines,
        cells: document.querySelectorAll('td.diff-code').length,
        rows: document.querySelectorAll('tr').length,
        hasNote: deferred.length ? !!deferred[0].querySelector('.deferred-note') : false,
        hasButton: deferred.length ? !!deferred[0].querySelector('.js-load-file') : false,
      };
    })()`);
    assert.ok(info.limit > 0, "expected a default large-file threshold");
    assert.ok(info.count > 0, "expected at least one deferred large file");
    assert.ok(info.hasNote && info.hasButton, "deferred file needs its note and Load button");
    // The point of deferring is a smaller DOM.
    assert.ok(info.cells < 5000, `deferred files should keep the DOM small, got ${info.cells} cells`);
  });

  await check("loading a deferred file renders and highlights it", async () => {
    const out = await js(`(async () => {
      const section = document.querySelector('.diff-file.is-deferred');
      if (!section) return { skip: true };
      const before = section.querySelectorAll('td.diff-code').length;
      section.querySelector('.js-load-file').click();
      await new Promise(r => setTimeout(r, 3000));
      const cells = [...section.querySelectorAll('td.diff-code')];
      return {
        skip: false,
        before,
        cells: cells.length,
        highlighted: cells.filter(c => c.dataset.highlighted === '1').length,
        stillDeferred: section.classList.contains('is-deferred'),
        hasExpandAll: !!section.querySelector('.js-expand-all'),
      };
    })()`);

    if (out.skip) return;
    assert.equal(out.before, 0, "a deferred file renders no rows");
    assert.ok(out.cells > 0, "loading must render the diff");
    assert.equal(out.highlighted, out.cells, "every row must be highlighted after loading");
    assert.ok(!out.stillDeferred, "the placeholder must be replaced");
    assert.ok(out.hasExpandAll, "Expand all replaces the Load button");
  });

  await check("every file header has a copy-path button", async () => {
    const out = await js(`(() => {
      const headers = [...document.querySelectorAll('.diff-file-header')];
      const withButton = headers.filter(h => h.querySelector('.js-copy-path'));
      const first = headers[0] ? headers[0].querySelector('.js-copy-path') : null;
      return {
        headers: headers.length,
        withButton: withButton.length,
        path: first ? first.dataset.path : null,
      };
    })()`);
    assert.ok(out.headers > 0, "expected file headers");
    assert.equal(out.withButton, out.headers, "every header must offer a copy-path button");
    assert.ok(out.path, "the button must carry the file path");
  });

  await check("comment editor spans the whole diff table", async () => {
    const out = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')]
        .find(s => s.querySelector('.js-comment'));
      if (!section) return { error: "no section with a comment button" };

      const button = section.querySelector('.js-comment');
      button.click();

      const table = section.querySelector('.diff-table');
      const editor = section.querySelector('.js-editor-row');
      if (!editor) return { error: "editor row was not created" };

      const columns = table.querySelectorAll('col').length;
      const codeCell = table.querySelector('tr .diff-code');
      const tableWidth = table.getBoundingClientRect().width;

      return {
        columns,
        colspan: editor.firstChild.colSpan,
        codeWidth: Math.round(codeCell.getBoundingClientRect().width),
        tableWidth: Math.round(tableWidth),
      };
    })()`);

    assert.equal(out.error, undefined, out.error);
    // A wrong colspan adds a column to the table and squeezes the code into
    // half the width, leaving a black gap on the right.
    assert.equal(out.colspan, out.columns, "the editor row must span every column");
    assert.ok(
      out.codeWidth > out.tableWidth * 0.8,
      `the code column must keep the table width, got ${out.codeWidth} of ${out.tableWidth}`,
    );

    // The split view has twice the columns, so it needs its own check.
    const split = await js(`(() => {
      const mode = document.getElementById('set-diff-mode');
      mode.value = 'split';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.ok(split);
    await new Promise((r) => setTimeout(r, 400));

    const splitOut = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')]
        .find(s => s.querySelector('.diff-table.split'));
      if (!section) return { error: "no split table" };
      section.querySelector('.js-comment').click();
      const table = section.querySelector('.diff-table.split');
      const editor = section.querySelector('.js-editor-row');
      if (!editor) return { error: "editor row was not created" };
      return {
        columns: table.querySelectorAll('col').length,
        colspan: editor.firstChild.colSpan,
      };
    })()`);

    assert.equal(splitOut.error, undefined, splitOut.error);
    assert.equal(splitOut.colspan, splitOut.columns, "the split editor row must span every column");
  });

  await check("commits tab lists only the reviewed commits", async () => {
    const out = await js(`(() => {
      const scope = PR.state.commits.map(c => c.sha);
      const listed = [...document.querySelectorAll('.commit-item .commit-subject')].length;
      return { scope: scope.length, listed };
    })()`);

    assert.ok(out.scope > 0, "the review must know its commits");
    assert.equal(out.listed, out.scope, "the tab must show exactly the scope commits");
  });

  await check("the submit dialog closes on Escape", async () => {
    await js(`(() => {
      document.getElementById('btn-submit').click();
      return true;
    })()`);

    await waitFor(`document.getElementById('dispatch-modal').classList.contains('show')`);

    await js(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    })()`);

    const shown = await js(`document.getElementById('dispatch-modal').classList.contains('show')`);
    assert.equal(shown, false, "Escape must close the submit dialog");
  });

  await check("comments from another tab reach the review", async () => {
    const before = await js(`PR.state.comments.length`);
    const path = await js(`PR.state.files[0].path`);

    const original = driver.getWindowHandle();
    await driver.switchTo().newWindow("tab");
    await driver.get(`${BASE.replace(/\/$/, "")}/file?path=${encodeURIComponent(path)}`);
    await waitFor(`!!document.querySelector('.viewer-table')`);

    // Comment through the viewer's own UI, the way a user does it.
    await js(`(() => {
      const button = document.querySelector('.js-v-comment');
      button.click();
      return true;
    })()`);
    await waitFor(`!!document.querySelector('.js-editor textarea')`);
    await js(`(() => {
      const textarea = document.querySelector('.js-editor textarea');
      textarea.value = 'cross tab comment';
      document.querySelector('.js-editor .js-save').click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 600));

    await driver.switchTo().window(original);
    await driver.wait(async () => {
      try { return await driver.executeScript("return PR.state.comments.length;"); }
      catch { return false; }
    }, 10_000);

    const after = await js(`PR.state.comments.length`);
    const paths = await js(`PR.state.comments.map(c => c.path)`);

    assert.equal(after, before + 1, "the viewer comment must arrive in the review");
    assert.ok(paths.includes(path), "the comment must keep its file");
  });

  await check("tree indent size is configurable by typing any value", async () => {
    const out = await js(`(() => {
      const field = document.getElementById('set-tree-indent');
      const results = [];

      const apply = (value) => {
        field.value = String(value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        const indent = [...document.querySelectorAll('.tree-indent')]
          .find(el => el.getBoundingClientRect().width > 0);
        return {
          typed: value,
          applied: PR.state.settings.treeIndent,
          cssVar: getComputedStyle(PR.els.tree).getPropertyValue('--tree-indent').trim(),
          rendered: indent ? Math.round(indent.getBoundingClientRect().width) : 0,
        };
      };

      // Narrow values below the old 12px preset must work.
      for (const size of [6, 8, 10]) results.push(apply(size));
      // Arbitrary values must be accepted.
      results.push(apply(14));
      // Out-of-range input must clamp instead of breaking the layout.
      results.push(apply(100));
      results.push(apply(1));

      PR.state.settings.treeIndent = PR.TREE_SIZE.DEFAULT_INDENT;
      PR.applyTreeIndent();

      return {
        results,
        isNumberInput: field.type === 'number',
        min: field.getAttribute('min'),
        max: field.getAttribute('max'),
      };
    })()`);

    for (const row of out.results.filter((r) => r.typed >= 4 && r.typed <= 14)) {
      assert.equal(row.applied, row.typed, `typed ${row.typed} must be applied`);
      assert.equal(row.cssVar, `${row.typed}px`);
      assert.equal(row.rendered, row.typed, `rendered indent should be ${row.typed}px`);
    }

    const tooBig = out.results.find((r) => r.typed === 100);
    assert.equal(tooBig.applied, 48, "values above the maximum must clamp");

    const tooSmall = out.results.find((r) => r.typed === 1);
    assert.equal(tooSmall.applied, 4, "values below the minimum must clamp");

    assert.ok(out.isNumberInput, "the indent field must accept typed numbers");
    assert.equal(out.min, "4");
    assert.equal(out.max, "48");
  });

  await check("Last file returns to the last viewed file", async () => {
    const path = await js(`(() => {
      const files = [...document.querySelectorAll('.diff-file')];
      const section = files[Math.min(3, files.length - 1)];
      section.querySelector('.viewed-wrap').click();
      window.scrollTo(0, 0);
      return section.dataset.path;
    })()`);
    await PAUSE(400);
    await js(`document.getElementById('back-to-last').click()`);
    await PAUSE(1400);
    const result = await js(`(() => {
      const section = [...document.querySelectorAll('.diff-file')].find(s => s.dataset.path === ${JSON.stringify(path)});
      const rect = section.getBoundingClientRect();
      return { top: rect.top, collapsed: section.classList.contains('collapsed'), y: window.scrollY, last: PR.state.lastViewedFile };
    })()`);
    assert.equal(result.last, path);
    assert.ok(!result.collapsed, "last file should be expanded");
    assert.ok(result.top < 300 && result.top > -400, `last file is not in view (top ${result.top}, scrollY ${result.y})`);
  });

  await check("Last file jumps to the first file when nothing is viewed", async () => {
    await js(`(() => {
      document.querySelectorAll('.viewed-wrap.checked').forEach(w => w.click());
      PR.state.lastViewedFile = null;
      window.scrollTo(0, document.body.scrollHeight);
      return true;
    })()`);
    await PAUSE(400);
    await js(`document.getElementById('back-to-last').click()`);

    const result = await (async () => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const probe = await js(`(() => {
          const first = document.querySelector('.diff-file');
          return { top: first.getBoundingClientRect().top, y: window.scrollY, viewed: PR.state.viewed.size };
        })()`);
        if (Math.abs(probe.top) < 300) return probe;
        await PAUSE(200);
      }
      return js(`(() => {
        const first = document.querySelector('.diff-file');
        return { top: first.getBoundingClientRect().top, y: window.scrollY, viewed: PR.state.viewed.size };
      })()`);
    })();

    assert.equal(result.viewed, 0, "expected no viewed files");
    assert.ok(result.top > -400 && result.top < 300, `first file is not in view (top ${result.top}, scrollY ${result.y})`);
  });

  // ---- viewer: hash navigation + commenting on an unmodified file ----------
  const viewerInfo = await js(`(() => {
    const changed = PR.state.changedPaths;
    const path = PR.state.allFiles.map(f => f.path).find(p => p.endsWith('.cs') && !changed.has(p));
    return { path, token: PR.state.files[0].path };
  })()`);
  const viewerUrl = `${BASE.replace(/\/$/, "")}/file?path=${encodeURIComponent(viewerInfo.path)}#L5`;
  await driver.get(viewerUrl);
  await waitFor(`document.querySelectorAll('.viewer-table tr[data-line]').length > 5`);
  await PAUSE(500);

  await check("viewer scrolls to #L5 and marks the target line", async () => {
    const result = await js(`(() => {
      const row = document.querySelector('tr[data-line="5"]');
      const rect = row.getBoundingClientRect();
      return { target: row.classList.contains('v-target'), top: rect.top, hash: location.hash, viewport: window.innerHeight };
    })()`);
    assert.equal(result.hash, "#L5");
    assert.ok(result.target, "line 5 is not marked as the target");
    assert.ok(result.top >= 0 && result.top < result.viewport, `line 5 is off-screen (${result.top})`);
  });

  await check("viewer can comment on a file that was not modified", async () => {
    await driver.executeScript(`document.querySelector('tr[data-line="6"] .js-v-comment').click()`);
    await PAUSE(300);
    const editor = await js(`!!document.querySelector('.js-editor')`);
    assert.ok(editor, "comment editor did not open");
    await js(`document.querySelector('.js-editor .js-text').value = 'comment on unchanged file'`);
    await js(`document.querySelector('.js-editor .js-save').click()`);
    await PAUSE(500);
    const saved = await js(`(() => {
      const box = [...document.querySelectorAll('.comment-box')].find(b => b.textContent.includes('comment on unchanged file'));
      return box ? box.textContent : null;
    })()`);
    assert.ok(saved, "comment was not saved in the viewer");
  });

  await check("viewer plus gutter exposes a + control on every line", async () => {
    const count = await js(`document.querySelectorAll('.js-v-comment').length`);
    assert.ok(count > 5, `expected plus controls, found ${count}`);
  });
} finally {
  await driver.quit();
}
if (failures.length) {
  console.error(`\n${failures.length} regression(s) failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("\nAll regressions passed");
