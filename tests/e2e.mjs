/**
 * End-to-end UI checks against the live review server (Firefox via geckodriver).
 * Verifies every requirement: viewed timing, collapse timing, multiline drag,
 * context expanders, symbol links, tree navigation, comments with images.
 *
 * Run: node tests/e2e.mjs [url]
 */
import { Builder, By, Key, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
const URL = process.argv[2] ?? "http://127.0.0.1:5454/";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}
async function main() {
  const options = new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 });
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();

  try {
    await driver.get(URL);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20000);

    check("page renders", (await driver.findElements(By.css(".diff-file"))).length > 0);
    check("tree renders all files", (await driver.findElements(By.css(".tree-row[data-dir='false']"))).length > 50);
    check("tabs present", (await driver.findElements(By.css(".gh-tab"))).length >= 2);
    check("header summary", (await driver.findElement(By.id("header-summary")).then((e) => e.getText())).includes("files"));
    check("settings button", (await driver.findElements(By.id("btn-settings"))).length === 1);

    /* 1. Viewed via a real click (user path) */
    const viewed = await driver.findElement(By.css(".viewed-wrap"));
    const t0 = Date.now();
    await viewed.click();
    await driver.wait(async () => (await driver.findElement(By.id("header-summary")).getText()).includes("1 /"), 5000);
    const clickMs = Date.now() - t0;
    check("viewed applies on click", true, `${clickMs} ms (incl. WebDriver)`);

    /* 2. Collapse timing (measured inside the page, no WebDriver overhead) */
    const collapseMs = await driver.executeScript(`
      const sections = document.querySelectorAll('.diff-file');
      const section = sections[1];
      section.classList.remove('collapsed');
      const t = performance.now();
      PR.toggleCollapse(section);
      const collapsed = section.classList.contains('collapsed');
      PR.toggleCollapse(section);
      return { ms: performance.now() - t, collapsed, expanded: !section.classList.contains('collapsed') };
    `);
    check("collapse works", collapseMs.collapsed && collapseMs.expanded, JSON.stringify(collapseMs));
    check("collapse is fast (<50ms)", collapseMs.ms < 50, `${collapseMs.ms.toFixed(1)} ms`);

    /* 2b. Viewed timing measured in-page */
    const viewedMs = await driver.executeScript(`
      const section = document.querySelectorAll('.diff-file')[1];
      const path = section.dataset.path;
      const t = performance.now();
      PR.toggleViewed(path);
      const ms = performance.now() - t;
      PR.toggleViewed(path);
      return ms;
    `);
    check("viewed is fast (<50ms)", viewedMs < 50, `${viewedMs.toFixed(1)} ms`);

    /* 3. Syntax highlighting present (hydration is async by design) */
    await driver.wait(async () => {
      const n = (await driver.findElements(By.css(".diff-code .hljs-keyword, .diff-code .hljs-string, .diff-code .hljs-type, .diff-code .hljs-title"))).length;
      return n > 5;
    }, 10000);
    const spanCount = (await driver.findElements(By.css(".diff-code .hljs-keyword, .diff-code .hljs-string, .diff-code .hljs-type, .diff-code .hljs-title"))).length;
    check("syntax highlighting tokens", spanCount > 5, `${spanCount} tokens`);

    /* 4. No bogus symbol links */
    const symNames = await Promise.all((await driver.findElements(By.css(".sym-link"))).map((e) => e.getText()));
    const bad = symNames.filter((n) => ["static", "using", "class", "public", "new"].includes(n));
    check("no keyword links", bad.length === 0, `bad=${bad.join(",")}`);

    /* 5. Multiline drag over the "+" gutter (GitHub behaviour) */
    const nums = await driver.findElements(By.css(".diff-file .diff-num[data-line]"));
    check("line numbers have data-line", nums.length > 10);

    const gutters = await driver.findElements(By.css(".diff-file .line-plus"));
    check("gutter has comment buttons", gutters.length > 10);

    await driver.executeScript(`
      const section = [...document.querySelectorAll('.diff-file')].find((s) =>
        !s.classList.contains('collapsed') && s.querySelectorAll('.line-plus').length > 10);
      const plus = section.querySelectorAll('.line-plus');
      plus[3].dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
      plus[9].dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    `);
    await new Promise((r) => setTimeout(r, 200));
    const selected = (await driver.findElements(By.css(".row-selected"))).length;
    check("drag selects a range", selected > 1, `${selected} rows`);
    const editor = (await driver.findElements(By.css(".js-editor textarea"))).length;
    check("comment editor opens after drag", editor === 1);

    /* 6. Comment with image chip */
    if (editor === 1) {
      await driver.executeScript(`
        const ta = document.querySelector('.js-editor textarea');
        if (ta) ta.scrollIntoView({block:'center'});
      `);
      const ta = await driver.findElement(By.css(".js-editor textarea"));
      await driver.executeScript("arguments[0].value = 'E2E comment'; arguments[0].dispatchEvent(new Event('input',{bubbles:true}));", ta);
      await driver.executeScript(`
        const box = document.querySelector('.js-editor');
        const chip = document.createElement('span');
        chip.className = 'attach-chip';
        chip.innerHTML = '<img src="data:image/png;base64,iVBORw0KGgo=">';
        box.querySelector('.js-chips').appendChild(chip);
      `);
      await driver.executeScript("document.querySelector('.js-editor .js-save').click()");
      await new Promise((r) => setTimeout(r, 250));
      const commentBoxes = (await driver.findElements(By.css(".comment-box"))).length;
      check("comment saved", commentBoxes > 0, `${commentBoxes} boxes`);
      const sidebar = await driver.findElement(By.id("comment-list")).then((e) => e.getText());
      check("comment appears in sidebar", sidebar.includes("E2E comment"));
    }

    /* 7. Context expanders (pick a section that is actually open) */
    const expandedPath = await driver.executeScript(`
      const section = [...document.querySelectorAll('.diff-file')].find((s) =>
        !s.classList.contains('collapsed') && s.querySelector('.hunk-expander .js-expand[data-dir="up"]'));
      if (!section) return null;
      section.querySelector('.hunk-expander .js-expand[data-dir="up"]').click();
      return section.dataset.path;
    `);
    const expanded = expandedPath
      ? await (async () => {
          for (let i = 0; i < 60; i += 1) {
            const n = await driver.executeScript(`
              const s = [...document.querySelectorAll('.diff-file')].find(x => x.dataset.path === ${JSON.stringify(expandedPath)});
              return s ? s.querySelectorAll('.row-ctx').length : 0;
            `);
            if (n > 3) return n;
            await new Promise((r) => setTimeout(r, 200));
          }
          return 0;
        })()
      : 0;
    check("expand context up", expanded > 3, `${expanded} context rows`);

    /* 8. Tree click on changed file reveals diff */
    const changedRow = await driver.findElement(By.css(".tree-row.status-modified[data-dir='false']"));
    await changedRow.click();
    const flashed = await driver.findElements(By.css(".diff-file.flash"));
    check("tree click reveals changed file", flashed.length > 0);

    /* 9. Commits tab */
    const commitTab = await driver.findElement(By.css(".gh-tab[data-tab='commits']"));
    await commitTab.click();
    await new Promise((r) => setTimeout(r, 250));
    const commits = (await driver.findElements(By.css(".commit-item"))).length;
    check("commits tab lists commits", commits > 0, `${commits} commits`);

    /* 9b. Commit picker: choose a range with two checkboxes */
    const scopeExists = await driver.executeScript(`
      return !!document.getElementById('scope-mode') && !!document.getElementById('commit-picker');
    `);
    check("scope picker present", scopeExists);

    if (scopeExists) {
      await driver.executeScript(`
        const mode = document.getElementById('scope-mode');
        mode.value = 'range';
        mode.dispatchEvent(new Event('change', {bubbles:true}));
      `);
      await driver.wait(async () => {
        const boxes = await driver.findElements(By.css(".commit-pick-box"));
        return boxes.length > 2;
      }, 10000);

      const pickerOpened = await driver.executeScript(`
        return document.getElementById('commit-picker').classList.contains('show')
          && document.querySelectorAll('.commit-pick').length > 2;
      `);
      check("commit picker opens with the commit list", pickerOpened);

      const pickedInfo = await driver.executeScript(`
        const boxes = [...document.querySelectorAll('.commit-pick-box')];
        const last = boxes.length - 1;
        const second = Math.min(1, last);
        boxes[second].click();
        boxes[last].click();
        return {
          count: PR.pickerDraft.length,
          expected: last - second + 1,
          hint: document.getElementById('commit-picker-count').textContent,
        };
      `);
      check("two checkboxes select the commits between them",
        pickedInfo.count === pickedInfo.expected,
        `${pickedInfo.count}/${pickedInfo.expected} commits · ${pickedInfo.hint}`);

      await driver.executeScript(`document.getElementById('commit-picker-save').click()`);
      await new Promise((r) => setTimeout(r, 300));
      await driver.executeScript(`document.getElementById('btn-open-scope').click()`);
      await driver.wait(async () => (await driver.findElements(By.css("#diff-view-bar"))).length === 1, 15000);
      const bar = await driver.findElement(By.id("diff-view-bar")).then((e) => e.getText());
      check("range review opens", bar.includes("Range"), bar.split("\n")[1] ?? bar.slice(0, 50));
    }

    /* 10. Commit diff opens */
    if (commits > 0) {
      await driver.executeScript(`
        document.querySelector(".gh-tab[data-tab='commits']").click();
      `);
      await new Promise((r) => setTimeout(r, 250));
      await driver.executeScript("document.querySelector('.commit-subject').click()");
      await driver.wait(async () => {
        const bars = await driver.findElements(By.css("#diff-view-bar"));
        if (!bars.length) return false;
        return (await bars[0].getText()).includes("Commit");
      }, 15000);
      const bar = await driver.findElement(By.id("diff-view-bar")).then((e) => e.getText());
      check("commit diff view opens", bar.includes("Commit"), bar.replace(/\n/g, " ").slice(0, 60));
    }

    /* 11. Viewer page + comments */
    await driver.get(URL.replace(/\/$/, "") + "/file?path=src/services/AtlasService/Atlas.Domain/Constants/AtlasConstants.cs");
    await driver.wait(until.elementLocated(By.css(".viewer-table")), 15000);
    const vnums = await driver.findElements(By.css(".v-num"));
    check("viewer renders", vnums.length > 0, `${vnums.length} lines`);
    await driver.executeScript(`
      const a = document.querySelectorAll('.v-num')[1], b = document.querySelectorAll('.v-num')[2];
      a.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
      b.dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    `);
    await new Promise((r) => setTimeout(r, 200));
    check("viewer comment editor", (await driver.findElements(By.css(".js-editor textarea"))).length === 1);

    /* 12. No JS errors so far, captured before the last navigation resets them. */
    const pageErrors = await driver.executeScript("return window.__errors || []");

    /* 13. Occurrence highlight: selecting a word lights up the same word in the
       same file, like an IDE. Double-click is simulated with a real Range. */
    await driver.get(URL);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20000);
    // The commits tab may be restored from localStorage by earlier steps, and
    // the files panel is then display:none — a Range inside it yields an empty
    // selection. Make the files tab active before selecting.
    await driver.executeScript(`
      const tab = document.querySelector(".gh-tab[data-tab='files']");
      if (tab) tab.click();
    `);
    // Wait for every section to finish hydrating: a later pass rewrites code
    // cells, and a range set on a node that is about to be replaced is lost.
    await driver.wait(async () => {
      const counts = await driver.executeScript(`return [
        document.querySelectorAll(".diff-file[data-hydrated='1']").length,
        document.querySelectorAll(".diff-file").length,
      ];`);
      return counts[1] > 0 && counts[0] >= counts[1];
    }, 30000);
    await new Promise((r) => setTimeout(r, 500));

    const pick = await driver.executeScript(`
      const sections = [...document.querySelectorAll('.diff-file')];
      for (const s of sections) {
        const cells = [...s.querySelectorAll('td.diff-code')];
        if (!cells.length) continue;
        const text = cells.map((c) => c.textContent).join(String.fromCharCode(10));
        const words = text.match(/\\b[A-Za-z_]{4,}\\b/g) || [];
        const counts = {};
        for (const w of words) counts[w] = (counts[w] || 0) + 1;
        const hit = Object.entries(counts).find((e) => e[1] >= 3);
        if (hit) return { path: s.dataset.path, word: hit[0] };
      }
      return null;
    `);
    check("a repeated word exists to select", Boolean(pick), JSON.stringify(pick));

    if (pick) {
      await driver.executeScript(`
        const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path === ${JSON.stringify(pick.path)});
        const cell = [...section.querySelectorAll('td.diff-code')].find((c) => c.textContent.includes(${JSON.stringify(pick.word)}));
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
          const at = (node.nodeValue || '').indexOf(${JSON.stringify(pick.word)});
          if (at !== -1) {
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + ${pick.word.length});
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            return true;
          }
          node = walker.nextNode();
        }
        return false;
      `);
      await new Promise((r) => setTimeout(r, 300));

      const hits = await driver.executeScript(`
        const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path === ${JSON.stringify(pick.path)});
        const marks = [...section.querySelectorAll('mark.occurrence-hl')];
        return { count: marks.length, texts: [...new Set(marks.map((m) => m.textContent))] };
      `);
      check("selecting a word highlights its occurrences", hits.count >= 3, JSON.stringify(hits));
      check("only the selected word is highlighted", hits.texts.length === 1 && hits.texts[0] === pick.word, JSON.stringify(hits.texts));

      const outside = await driver.executeScript(`
        const section = [...document.querySelectorAll('.diff-file')].find((s) => s.dataset.path === ${JSON.stringify(pick.path)});
        return [...document.querySelectorAll('mark.occurrence-hl')].filter((m) => !section.contains(m)).length;
      `);
      check("the highlight stays inside one file", outside === 0, `outside=${outside}`);

      await driver.executeScript(`
        window.getSelection().removeAllRanges();
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      `);
      await new Promise((r) => setTimeout(r, 300));
      const left = (await driver.findElements(By.css("mark.occurrence-hl"))).length;
      check("the highlight clears on the next gesture", left === 0, `left=${left}`);
    }

    /* 14. No JS errors */
    check("no runtime errors", !pageErrors || pageErrors.length === 0, JSON.stringify(pageErrors || []));
  } finally {
    await driver.quit();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
