/**
 * The launcher contract every editor integration relies on.
 *
 * VS Code, Visual Studio and Zed all run `src/cli.js`, read the one
 * `PR_REVIEW_READY` line from stdout and take the URL from it. If that line,
 * its fields or the exit behaviour change, all three break at once — so this
 * test runs the real program and checks the contract end to end.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { CLI, GIT, ROUTES } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const CLI_SCRIPT = join(ROOT, "..", "src", "cli.js");
const failures = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(`${name}: ${error.message}`);
        console.log(`FAIL ${name} — ${error.message}`);
      },
    );
}
/** Runs the launcher and resolves with the parsed ready line, or rejects. */
function runCli(args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_SCRIPT, ...args], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PR_REVIEW_OPEN: "0" },
    });

    const reader = createInterface({ input: child.stdout });
    let stderr = "";
    const timer = setTimeout(() => reject(new Error("the launcher did not answer in time")), 60_000);

    reader.on("line", (line) => {
      if (!line.startsWith(CLI.READY_PREFIX)) return;
      clearTimeout(timer);
      const info = JSON.parse(line.slice(CLI.READY_PREFIX.length));
      resolve({ child, info });
    });

    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(stderr.trim() || `the launcher exited with code ${code}`));
    });
  });
}
const repo = await mkdtemp(join(tmpdir(), "pr-review-cli-"));
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });
try {
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/app.ts"), "export const value = 1;\n");
  await git("add", "-A");
  await git("commit", "-m", "init");

  // The base a branch review resolves to. Without it the branch scope has no
  // diff to show, which is what a fresh clone without remotes looks like.
  const trunk = (await git("rev-parse", "HEAD")).stdout.trim();
  await git("update-ref", "refs/remotes/origin/dev", trunk);

  // An uncommitted change, for the uncommitted scope.
  await writeFile(join(repo, "src/app.ts"), "export const value = 2;\n");

  let child = null;
  let info = null;

  await check("the launcher prints one ready line with every field", async () => {
    const result = await runCli(["--repo", repo, "--mode", "uncommitted", "--json"], { cwd: repo });
    child = result.child;
    info = result.info;

    assert.equal(info.ok, true);
    assert.ok(info.url.startsWith("http://127.0.0.1:"), `unexpected url ${info.url}`);
    assert.ok(info.reviewId, "the review id is missing");
    assert.ok(Number.isInteger(info.port) && info.port > 0, "the port is missing");
    assert.equal(info.mode, "uncommitted");
    assert.ok(info.files >= 1, "the changed file is missing");
    assert.ok(info.outputDir, "the artifacts directory is missing");
  });

  await check("the page answers and reports its protocol version", async () => {
    const response = await fetch(new URL(ROUTES.API_VERSION, info.url));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.name, "pr-review");
    assert.ok(payload.version, "the version is missing");
    assert.ok(payload.protocol, "the protocol version is missing");
    assert.equal(payload.reviewId, info.reviewId);
  });

  await check("the branch scope is the current branch, not the whole project", async () => {
    await git("checkout", "-b", "feature");
    await git("add", "-A");
    await git("commit", "-m", "change the value on the feature branch");

    const result = await runCli(["--repo", repo, "--mode", "branch", "--json"], { cwd: repo });
    const branch = result.info;
    result.child.kill();

    assert.equal(branch.mode, "branch");
    assert.equal(branch.base, "origin/dev", `unexpected base ${branch.base}`);
    assert.ok(branch.additions >= 1, "the branch change is missing");
    assert.ok(branch.files >= 1, "the branch changed no file");
  });

  await check("the launcher stops when it is signalled", async () => {
    // On Windows a killed child reports a null code, so the exit itself is the
    // assertion: the process must not outlive the signal.
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  });
} finally {
  await rm(repo, { recursive: true, force: true });
}
