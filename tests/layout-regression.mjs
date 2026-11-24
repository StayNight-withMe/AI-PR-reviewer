/**
 * The review page must stay readable at the width of a Visual Studio tab.
 *
 * A tab is roughly 650 px wide. At that size the page has to give the diff the
 * whole pane, hide the tree, and never cut a line of code off the right edge.
 * On a wide screen the opposite matters: the sidebar has to sit beside the diff
 * instead of squeezing it.
 *
 * Run: node tests/layout-regression.mjs
 */
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { createE2eReview } from "./e2e-fixture.mjs";

const NARROW = 655;
const MEDIUM = 1000;
const WIDE = 1440;
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Everything the assertions need, measured in one round trip. */
async function measure(driver, mode) {
  await driver.executeScript(`PR.setDiffMode('${mode}'); return true;`);
  await PAUSE(400);
  return driver.executeScript(`return (function(){
    function box(selector) {
      var el = document.querySelector(selector);
      if (!el) return null;
      var rect = el.getBoundingClientRect();
      var style = getComputedStyle(el);
      return {
        width: Math.round(rect.width),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        display: style.display,
        client: el.clientWidth,
        scroll: el.scrollWidth,
      };
    }
    var code = document.querySelector('.diff-code');
    var layout = box('.gh-layout');
    var main = box('#main-panel');
    var files = box('#diff-files');
    var sidebar = box('#sidebar');
    var tree = box('.gh-tree');
    return {
      inner: window.innerWidth,
      mode: PR.state.diffMode,
      layout: layout,
      main: main,
      files: files,
      sidebar: sidebar,
      tree: tree,
      codeWrap: code ? getComputedStyle(code).whiteSpace : null,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })();`);
}

async function main() {
  const fixture = await createE2eReview();
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: WIDE, height: 900 }))
    .build();

  try {
    await driver.get(fixture.url);
    await driver.wait(async () => driver.executeScript(`return document.body.dataset.booted === '1';`), 20_000);
    await driver.wait(async () => driver.executeScript(`return !!document.querySelector('.diff-code');`), 20_000);

    for (const width of [NARROW, MEDIUM, WIDE]) {
      await driver.manage().window().setRect({ width, height: 900 });
      await PAUSE(500);

      for (const mode of ["unified", "split"]) {
        const m = await measure(driver, mode);
        const label = `${width}px [${mode}]`;

        // Nothing may be cut off: not the page, not the pane, not the diff list.
        check(`${label}: the page does not scroll sideways`, m.docOverflow <= 1, `overflowX=${m.docOverflow}`);
        check(`${label}: the diff pane does not clip its content`,
          m.files && m.files.scroll <= m.files.client + 1,
          `client=${m.files?.client} scroll=${m.files?.scroll}`);

        // Long lines wrap instead of disappearing past the right edge.
        check(`${label}: code lines wrap instead of being cut`, m.codeWrap === "pre-wrap", `white-space=${m.codeWrap}`);

        if (width === NARROW) {
          check(`${label}: the file tree gives way to the diff`, m.tree.display === "none", `tree=${m.tree.display}`);
          check(`${label}: the diff uses the whole pane`,
            m.files.width >= Math.round(m.main.width * 0.85),
            `diff=${m.files.width} pane=${m.main.width}`);
        }

        if (width === WIDE) {
          check(`${label}: the sidebar sits beside the diff`,
            m.sidebar.display !== "none" && m.sidebar.left > m.main.left + m.main.width - 2,
            `sidebar.left=${m.sidebar.left} main.right=${m.main.left + m.main.width}`);
          check(`${label}: the diff keeps most of the width`,
            m.files.width >= Math.round(m.layout.width * 0.5),
            `diff=${m.files.width} layout=${m.layout.width}`);
        }
      }
    }
  } finally {
    await driver.quit();
    await fixture?.cleanup?.();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error("crashed:", error.message);
  process.exit(2);
});
