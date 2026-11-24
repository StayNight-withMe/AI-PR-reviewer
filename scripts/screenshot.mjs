
import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { writeFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:5454/";
const OUT = process.argv[3] ?? "docs/screenshot-review.png";

const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless").windowSize({ width: 1600, height: 1000 }))
  .build();

try {
  await driver.get(BASE);
  await driver.wait(async () => {
    try {
      return await driver.executeScript(
        `return document.querySelectorAll('.diff-file').length > 0 &&
         [...document.querySelectorAll('.diff-file')].some(s => s.dataset.hydrated === '1');`,
      );
    } catch { return false; }
  }, 60000);


  await driver.sleep(4500);
  await driver.executeScript(`
    const first = document.querySelector('.diff-file:not(.collapsed)');
    if (first && first.querySelector('.js-collapse')) first.querySelector('.js-collapse').click();
    const plus = first && first.querySelector('.line-plus.js-comment');
    if (plus) plus.click();
    return true;
  `);
  await driver.sleep(900);
  const png = await driver.takeScreenshot();
  await writeFile(OUT, Buffer.from(png, "base64"));
  console.log(`wrote ${OUT}`);
} finally {
  await driver.quit();
}
