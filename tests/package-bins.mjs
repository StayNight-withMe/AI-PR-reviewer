/**
 * The commands npm installs (`bin` in package.json) must start with a shebang.
 *
 * Without it npm writes a shim that hands the .js file to Windows, which opens
 * it in an editor instead of running it — and the command looks broken.
 *
 * Run: node tests/package-bins.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const pkg = JSON.parse(await readFile(join(ROOT, "..", "package.json"), "utf8"));
const bins = Object.entries(pkg.bin ?? {});

await check("package.json declares the pr command", () => {
  assert.equal(pkg.bin?.pr, "src/pr.js", "the pr command is not declared in bin");
});

await check("review is an alias of the pr command", () => {
  assert.equal(pkg.bin?.review, pkg.bin?.pr, "review must run the same entry point as pr");
});

for (const [name, file] of bins) {
  await check(`${name} starts with a Node shebang`, async () => {
    const source = await readFile(join(ROOT, "..", file), "utf8");
    assert.match(source.slice(0, 40), /^#!\/usr\/bin\/env node\r?\n/, `${file} has no shebang, npm would install a broken shim`);
  });
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll package bin checks passed");
}
