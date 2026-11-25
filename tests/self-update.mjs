/**
 * The update note and the update command must never touch a newer checkout.
 *
 * Run: node tests/self-update.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isNewer } from "../src/update-check.js";

const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

await check("a version is newer only when it really is", () => {
  assert.equal(isNewer("1.2.1", "1.2.0"), true);
  assert.equal(isNewer("1.3.0", "1.2.9"), true);
  assert.equal(isNewer("2.0.0", "1.99.99"), true);
  assert.equal(isNewer("1.2.0", "1.2.0"), false);
  assert.equal(isNewer("0.8.0", "1.2.0"), false, "an older registry version must not count as an update");
  assert.equal(isNewer("1.1.9", "1.2.0"), false);
  assert.equal(isNewer("1.2.0-beta.1", "1.2.0"), false, "a pre-release of the same version is not newer");
});

await check("the updater reports an older registry version as nothing to do", async () => {
  const { stdout } = await exec(process.execPath, [join(ROOT, "..", "scripts", "self-update.mjs"), "--check"], {
    windowsHide: true,
    timeout: 120_000,
  });
  assert.match(stdout, /Installed: pr-review-mcp \d+\.\d+\.\d+/);
  if (/Latest:\s+pr-review-mcp 0\./.test(stdout)) {
    assert.match(stdout, /Up to date/, `unexpected answer for an older registry: ${stdout}`);
  }
});

await check("a failed registry call exits with a clear message", async () => {
  const broker = await mkdtemp(join(tmpdir(), "self-update-"));
  try {
    await mkdir(join(broker, "scripts"), { recursive: true });
    await writeFile(join(broker, "package.json"), JSON.stringify({ name: "pr-review-mcp", version: "9.9.9" }));
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(join(ROOT, "..", "scripts", "self-update.mjs"), "utf8");
    const patched = source.replace('await npm(["view", local.name, "version"])', 'await npm(["view", local.name, "version", "--registry", "http://127.0.0.1:1"])');
    await writeFile(join(broker, "scripts", "self-update.mjs"), patched);
    const result = await exec(process.execPath, [join(broker, "scripts", "self-update.mjs"), "--check"], {
      windowsHide: true,
      timeout: 180_000,
    }).catch((error) => error);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.notEqual(result.code, 0, "a failed registry call must not report success");
    assert.match(output, /Could not reach the npm registry/, `unexpected output: ${output.slice(0, 300)}`);
  } finally {
    await rm(broker, { recursive: true, force: true });
  }
});

await check("the update note stays silent when it is turned off", async () => {
  const { noteUpdateIfAvailable } = await import("../src/update-check.js");
  const before = process.env.PR_REVIEW_NO_UPDATE_CHECK;
  process.env.PR_REVIEW_NO_UPDATE_CHECK = "1";
  try {
    const written = [];
    const original = process.stderr.write;
    process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      await noteUpdateIfAvailable(new URL("../package.json", import.meta.url));
    } finally {
      process.stderr.write = original;
    }
    assert.deepEqual(written, [], "the note was printed although the check is off");
  } finally {
    if (before === undefined) delete process.env.PR_REVIEW_NO_UPDATE_CHECK;
    else process.env.PR_REVIEW_NO_UPDATE_CHECK = before;
  }
});

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll self-update checks passed");
}
