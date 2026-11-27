/**
 * Two reviews of the same scope must run side by side.
 *
 * Both used to write the same page.json inside one artifact folder, so the
 * second page overwrote the first entry and the process that was still
 * starting never saw its own registry: it waited out the start timeout and
 * fell back to a blocking page inside the command. Here the two pages are
 * started at once and each must find its own registry quickly.
 *
 * Run: node tests/concurrent-pages.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnPageProcess, findFreePort, findPageRegistry, waitForPageRegistry } from "../src/page-process.js";
import { GIT, MODE } from "../src/config.js";

const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-concurrent-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src/a.txt"), "one\n");
  const run = (args) => execFileSync(GIT.BIN, args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  run(["init"]);
  run(["-c", "user.email=t@t.t", "-c", "user.name=t", "add", "-A"]);
  run(["-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "base"]);
  await writeFile(join(root, "src/a.txt"), "two\n");
  return root;
}

const root = await makeRepo();
const spawned = [];
process.env.PR_REVIEW_ARTIFACTS_DIR = await mkdtemp(join(tmpdir(), "pr-review-concurrent-artifacts-"));

await check("two pages of one scope start and both register", async () => {
  const started = Date.now();

  for (let index = 0; index < 2; index += 1) {
    const port = await findFreePort();
    spawned.push(spawnPageProcess({
      repoPath: root,
      mode: MODE.UNCOMMITTED,
      port,
      symbols: false,
    }));
  }

  const entries = await Promise.all(spawned.map((item) => waitForPageRegistry(root, {
    pid: item.child.pid,
    timeoutMs: 60_000,
  })));

  const elapsed = Date.now() - started;

  assert.ok(entries[0], "the first page did not register");
  assert.ok(entries[1], "the second page did not register");
  assert.notEqual(entries[0].port, entries[1].port, "the pages share a port");
  assert.notEqual(entries[0].pid, entries[1].pid, "the pages share a pid");
  assert.ok(elapsed < 60_000, `both pages should be ready well before the start timeout, took ${elapsed}ms`);
});

await check("each page keeps its own registry file", async () => {
  const entries = await Promise.all(spawned.map((item) => waitForPageRegistry(root, { pid: item.child.pid, timeoutMs: 5_000 })));
  const dir = entries[0].outputDir;
  assert.equal(entries[1].outputDir, dir, "both pages should use the same artifact folder for this scope");

  const files = (await readdir(dir)).filter((name) => /^page(-\d+)?\.json$/.test(name));
  assert.ok(files.length >= 2, `expected one registry per page, found ${files.join(", ")}`);
});

await check("the registry lookup still finds a running page", async () => {
  const found = await findPageRegistry(root);
  assert.ok(found, "no page registry was found");
  assert.ok(found.port, "the found entry has no port");
});

for (const item of spawned) {
  try { process.kill(item.child.pid, "SIGTERM"); } catch { /* already gone */ }
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll concurrent-page checks passed");
}
