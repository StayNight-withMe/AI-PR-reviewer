/**
 * `pr <url>` opens a review of a GitHub pull request and prints its address.
 *
 * Offline: the mock `gh` serves the pull request and the fixture repository
 * carries its commits, so the command runs exactly as a person runs it.
 *
 * Run: node tests/pr-command.mjs
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { GH } from "../src/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const COMMAND = join(ROOT, "..", "src", "pr.js");
const MOCK_GH = join(ROOT, "fixtures", "mock-gh.mjs");
const PAUSE = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "pr-command-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
}));

/**
 * Starts the command and waits until its page answers.
 *
 * The process is left running: the caller reads the page and then closes it.
 */
function startPr(args, { cwd = fixture.repo, timeoutMs = 120_000 } = {}) {
  const child = spawn(process.execPath, [COMMAND, ...args], {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      [GH.ENV_BIN]: MOCK_GH,
      MOCK_GH_DB: dbPath,
      PR_REVIEW_ARTIFACTS_DIR: join(dbDir, "artifacts"),
    },
  });
  let stdout = "";
  let stderr = "";

  const close = () => {
    try { child.kill(); } catch { /* already gone */ }
  };

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
      close();
      reject(new Error(`timeout; stderr=${stderr.slice(0, 300)}`));
    }, timeoutMs);

    const settle = async () => {
      const match = /Local page: (http\S+)/.exec(stdout);
      if (!match || Date.now() > deadline) return false;
      const url = match[1];
      try {
        const response = await fetch(`${url}api/version`);
        const version = await response.json();
        clearTimeout(timer);
        resolve({ url, stdout, version, close, stderr });
        return true;
      } catch {
        return false;
      }
    };

    child.stdout.on("data", (chunk) => { stdout += chunk; void settle(); });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (/Local page:/.test(stdout)) return;
      reject(new Error(`exit ${code}; stderr=${stderr.slice(0, 300)}`));
    });
  });
}

/** Runs a command that must fail, and returns its error text. */
function runFailing(args, { cwd = fixture.repo, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [COMMAND, ...args], {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        [GH.ENV_BIN]: MOCK_GH,
        MOCK_GH_DB: dbPath,
        PR_REVIEW_ARTIFACTS_DIR: join(dbDir, "artifacts"),
      },
    });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("the command did not fail in time")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) { reject(new Error(`expected a failure, got success: ${output.slice(0, 300)}`)); return; }
      resolve(output);
    });
  });
}

try {
  await check("a full GitHub URL opens the review and prints a local address", async () => {
    const run = await startPr([`https://github.com/acme/fixture/pull/${PR_NUMBER}`, "--no-open"]);
    try {
      assert.match(run.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.equal(run.version.ok, true);
      assert.ok(run.version.reviewId.length > 0);

      const html = await (await fetch(run.url)).text();
      assert.match(html, /pr-badge/, "the page has no PR badge");
      assert.match(html, new RegExp(`github\\.com/acme/fixture/pull/${PR_NUMBER}`));
      assert.match(run.stdout, /Reviewing https:\/\/github\.com\/acme\/fixture\/pull\//);
    } finally {
      run.close();
    }
  });

  await check("the short owner/repo#number form works too", async () => {
    const run = await startPr([`acme/fixture#${PR_NUMBER}`, "--no-open"]);
    try {
      const html = await (await fetch(run.url)).text();
      assert.match(html, /pr-badge/);
    } finally {
      run.close();
    }
  });

  await check("a plain number uses the pull request of the branch", async () => {
    const run = await startPr([String(PR_NUMBER), "--no-open"]);
    try {
      const html = await (await fetch(run.url)).text();
      assert.match(html, /pr-badge/);
    } finally {
      run.close();
    }
  });

  await check("an unusable argument explains the accepted forms", async () => {
    const output = await runFailing(["not-a-pull-request", "--no-open"], { timeoutMs: 30_000 });
    assert.match(output, /Could not read a pull request/);
    assert.match(output, /owner\/repo#123/);
  });

  await check("running outside a Git repository says what to do", async () => {
    const empty = await mkdtemp(join(tmpdir(), "pr-command-empty-"));
    try {
      const output = await runFailing([`https://github.com/acme/fixture/pull/${PR_NUMBER}`, "--no-open"], {
        cwd: empty,
        timeoutMs: 30_000,
      });
      assert.match(output, /not a Git repository/);
      assert.match(output, /checkout/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  await check("an unknown pull request names the problem", async () => {
    const output = await runFailing(["https://github.com/acme/fixture/pull/9999", "--no-open"]);
    assert.match(output, /no pull requests found|Check that the pull request exists/i);
  });

  await check("a page that was closed stops the command", async () => {
    const run = await startPr([`acme/fixture#${PR_NUMBER}`, "--no-open"]);
    run.close();
    await PAUSE(1200);
  });
} finally {
  await fixture.cleanup();
  await rm(dbDir, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll pr command checks passed");
}
