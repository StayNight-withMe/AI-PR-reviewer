
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { createE2eReview } from "./e2e-fixture.mjs";
const EXTERNAL_URL = process.argv[2];
let BANK = EXTERNAL_URL ?? "http://127.0.0.1:5454/";
let fixture;
const results = [];
const check = (n, ok, d = "") => { results.push({ n, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`); };
async function main() {
  if (!EXTERNAL_URL) {
    fixture = await createE2eReview();
    BANK = fixture.url;
  }
  const options = new firefox.Options().addArguments("-headless").windowSize({ width: 1700, height: 1100 });
  const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).build();

  try {
    await driver.get(BANK);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20000);


    await driver.findElement(By.id("btn-settings")).click();
    await new Promise((r) => setTimeout(r, 150));
    check("settings panel opens", await driver.executeScript("return document.getElementById('settings-pop').classList.contains('show')"));

    const hasFields = await driver.executeScript(`
      return ['set-tree-open','set-diff-mode','set-hide-viewed','set-collapse-viewed','set-symlinks']
        .every((id) => !!document.getElementById(id));
    `);
    check("all settings fields present", hasFields);


    await driver.executeScript(`
      const el = document.getElementById('set-tree-open');
      el.value = 'new';
      el.dispatchEvent(new Event('change', {bubbles:true}));
    `);


    await new Promise((r) => setTimeout(r, 300));
    const stored = await driver.executeScript(`return (async () => {
      const local = JSON.parse(localStorage.getItem(PR.SETTINGS_KEY) || '{}').treeOpen;
      const response = await fetch(PR.API.SETTINGS).then(r => r.json());
      return { local, server: response && response.settings ? response.settings.treeOpen : null };
    })()`);
    check("setting persists", stored.local === "new" && stored.server === "new", JSON.stringify(stored));
    await driver.executeScript(`
      const el = document.getElementById('set-tree-open');
      el.value = 'current';
      el.dispatchEvent(new Event('change', {bubbles:true}));
    `);


    await driver.executeScript(`
      const el = document.getElementById('set-diff-mode');
      el.value = 'split';
      el.dispatchEvent(new Event('change', {bubbles:true}));
    `);
    await new Promise((r) => setTimeout(r, 300));
    check("split table renders", (await driver.findElements(By.css(".diff-table.split"))).length > 0);
    await driver.executeScript(`
      const el = document.getElementById('set-diff-mode');
      el.value = 'unified';
      el.dispatchEvent(new Event('change', {bubbles:true}));
    `);
    await new Promise((r) => setTimeout(r, 200));
    check("unified restores", (await driver.findElements(By.css(".diff-table:not(.split)"))).length > 0);


    await driver.findElement(By.id("btn-theme")).click();
    await new Promise((r) => setTimeout(r, 120));
    check("light theme applies", (await driver.executeScript("return document.documentElement.getAttribute('data-theme')")) === "light");
    const bg = await driver.executeScript("return getComputedStyle(document.body).backgroundColor");
    const rgb = bg.match(/rgb\((\d+), (\d+), (\d+)\)/);
    const isLight = rgb && Number(rgb[1]) > 200 && Number(rgb[2]) > 200 && Number(rgb[3]) > 200;
    check("light background is light", Boolean(isLight), bg);
    await driver.findElement(By.id("btn-theme")).click();


    await driver.executeScript(`
      const first = document.querySelector('.viewed-wrap');
      first.click();
    `);
    await new Promise((r) => setTimeout(r, 150));
    const beforeHide = (await driver.findElements(By.css(".diff-file"))).length;
    await driver.findElement(By.id("toggle-viewed")).click();
    await new Promise((r) => setTimeout(r, 250));
    const afterHide = (await driver.findElements(By.css(".diff-file"))).length;
    check("hide viewed removes a file", afterHide < beforeHide, `${beforeHide} -> ${afterHide}`);
    await driver.findElement(By.id("toggle-viewed")).click();


    const colourStats = await driver.executeScript(`
      const cells = [...document.querySelectorAll('td.diff-code')].slice(0, 120);
      const colours = new Set();
      for (const cell of cells) {
        for (const el of cell.querySelectorAll('span')) {
          colours.add(getComputedStyle(el).color);
        }
      }
      return { distinct: colours.size, colours: [...colours].slice(0, 8) };
    `);
    check("multiple syntax colours", colourStats.distinct >= 3, `${colourStats.distinct} colours`);


    await driver.get(BANK.replace(/\/$/, "") + "/file?path=src/services/AtlasService/Atlas.Domain/Entities/KnowledgeArticle.cs");
    await driver.wait(until.elementLocated(By.css(".viewer-table")), 15000);



    const viewerShape = await driver.executeScript(`
      const rows = [...document.querySelectorAll('.v-code')];
      const colours = new Set();
      for (const el of document.querySelectorAll('.v-code span')) colours.add(getComputedStyle(el).color);
      return {
        spans: document.querySelectorAll('.v-code span').length,
        colours: colours.size,
        tinted: document.querySelectorAll('.v-row.row-add, .v-row.row-del, .v-changed').length,
        rows: rows.length,
        sample: rows.length ? rows[0].textContent : '',
      };
    `);
    check("viewer highlights the file's syntax", viewerShape.spans > 0, `${viewerShape.spans} spans`);
    check("viewer shows no diff tint on any line", viewerShape.tinted === 0, `${viewerShape.tinted} tinted rows`);
    check("viewer renders every line", viewerShape.rows > 3, `${viewerShape.rows} rows`);

    await driver.executeScript(`
      const rows = document.querySelectorAll('.v-num');
      rows[1].dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
      rows[3].dispatchEvent(new MouseEvent('mouseover', {bubbles:true}));
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
    `);
    await new Promise((r) => setTimeout(r, 200));
    check("viewer comment form", (await driver.findElements(By.css(".js-editor textarea"))).length === 1);


    const api = await driver.executeScript(`
      return (async () => {
        const out = {};
        const r1 = await fetch('/api/commits'); out.commits = (await r1.json()).commits.length;
        const sha = (await (await fetch('/api/commits')).json()).commits[0].sha;
        const r2 = await fetch('/api/commit?sha=' + sha); const j2 = await r2.json(); out.commitFiles = j2.files.length;
        const r3 = await fetch('/api/usages?name=IHasUpdatedAt'); out.usages = (await r3.json()).usages.length;
        const r4 = await fetch('/api/paths'); out.paths = !!(await r4.json()).jsonPath;
        const r5 = await fetch('/api/files', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({paths:['README.md']})});
        out.batch = Object.keys((await r5.json()).files).length;
        return out;
      })();
    `);
    check("api commits", api.commits > 0, String(api.commits));
    check("api commit diff", api.commitFiles > 0, String(api.commitFiles));
    check("api usages", api.usages > 0, String(api.usages));
    check("api paths", api.paths);
    check("api batch files", api.batch > 0, String(api.batch));


    await driver.get(BANK);
    await driver.wait(until.elementLocated(By.css(".diff-file")), 20000);
    const submit = await driver.executeScript(`
      return (async () => {
        const res = await fetch('/api/review', {
          method: 'POST',
          headers: {'content-type':'application/json'},
          body: JSON.stringify({
            id: PR.DATA.id, repo: PR.DATA.repo, branch: PR.DATA.branch, base: PR.DATA.base, head: PR.DATA.head,
            mode: PR.DATA.mode,
            files: PR.state.files.map(f=>({path:f.path,status:f.status,additions:f.additions,deletions:f.deletions})),
            comments: [{id:'c1',path:PR.state.files[0].path,side:'right',lineStart:1,lineEnd:1,body:'smoke',images:[]}],
            viewedFiles: [], reviewState:'COMMENT', reviewBody:'',
            summary: {files:PR.state.files.length,additions:0,deletions:0,comments:1},
          }),
        });
        return await res.json();
      })();
    `);
    check("submit returns paths", Boolean(submit.jsonPath && submit.markdownPath), submit.jsonPath ?? "");

    if (submit.jsonPath) {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(submit.jsonPath, "utf8").catch(() => null);
      check("review.json written", Boolean(raw), submit.jsonPath);
      if (raw) {
        const parsed = JSON.parse(raw);
        check("review.json contains comment", parsed.review.comments.length === 1);
      }
    }


    await driver.manage().window().setRect({ width: 1280, height: 800 });
    await new Promise((r) => setTimeout(r, 400));

    for (const visible of [true, false]) {
      await driver.executeScript(
        visible ? `document.body.classList.remove('no-sidebar')` : `document.body.classList.add('no-sidebar')`,
      );
      await new Promise((r) => setTimeout(r, 250));

      const layout = await driver.executeScript(`
        return (() => {
          const sidebar = document.getElementById('sidebar');
          const main = document.getElementById('main-panel');
          const shown = getComputedStyle(sidebar).display !== 'none';
          const m = main.getBoundingClientRect();
          const s = sidebar.getBoundingClientRect();
          return {
            shown,
            overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            beside: s.left >= m.left + m.width - 1,
            top: Math.round(s.top),
          };
        })()
      `);

      check(`sidebar ${visible ? "visible" : "hidden"} matches the toggle`, layout.shown === visible);
      check(`sidebar ${visible ? "visible" : "hidden"}: no horizontal scroll`, layout.overflowX <= 1, `overflowX=${layout.overflowX}`);
      if (visible) {
        check("sidebar sits beside the diff, not below it", layout.beside);
        check("sidebar stays at the top of the layout", layout.top < 160, `top=${layout.top}`);
      }
    }
    await driver.executeScript(`document.body.classList.remove('no-sidebar')`);
    await driver.manage().window().setRect({ width: 1700, height: 1100 });
  } finally {
    await driver.quit();
    await fixture?.cleanup?.();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e.message); process.exit(2); });
