/**
 * Opening the review page in a browser must never crash the command.
 *
 * A detached child without an `error` listener turned a missing opener into an
 * unhandled event: on Linux servers and containers without `xdg-open` the
 * process died right after printing the address, and the review page was gone.
 *
 * Run: node tests/open-browser.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { openInBrowser, openerCommand } from "../src/open-browser.js";

const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

await check("each platform picks the opener it has", () => {
  assert.equal(openerCommand("win32").command, "cmd");
  assert.deepEqual(openerCommand("win32").args("http://x"), ["/c", "start", "", "http://x"]);
  assert.equal(openerCommand("darwin").command, "open");
  assert.equal(openerCommand("linux").command, "xdg-open");
});

await check("a missing opener returns without throwing", () => {
  // The PATH is irrelevant here: `spawn` does not throw synchronously for a
  // missing binary, so the guard has to be the `error` listener, not a try.
  assert.doesNotThrow(() => openInBrowser("http://127.0.0.1:1/"));
});

await check("a missing opener does not kill the process", async () => {
  // Real reproduction: a child process that calls openInBrowser with a binary
  // that cannot exist, then stays alive. Without the `error` listener the
  // unhandled event ends the process with a non-zero code.
  const script = `
    import { openInBrowser } from ${JSON.stringify(new URL("../src/open-browser.js", import.meta.url).href)};
    openInBrowser("http://127.0.0.1:1/", { platform: "linux" });
    process.env.PATH = "";
    setTimeout(() => { console.log("alive"); process.exit(0); }, 600);
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    windowsHide: true,
    env: { ...process.env, PATH: "" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  assert.equal(code, 0, `the process died: ${stderr.slice(0, 300)}`);
  assert.match(stdout, /alive/, "the process did not survive the failed spawn");
});

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll open-browser checks passed");
}
