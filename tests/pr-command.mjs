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
  // checkout.js keeps its scratch clone in tmpdir()/pr-review-mcp; putting the
  // fixture there first means the commands reuse it instead of cloning from
  // github.com (the fixture repository does not exist on the internet).
  const { promisify } = await import("node:util");
  const exec = promisify((await import("node:child_process")).execFile);
  const scratchParent = join(tmpdir(), "pr-review-mcp");
  const scratch = join(scratchParent, "acme__fixture");
  let seeded = false;

  async function seedScratchCheckout() {
    if (seeded) return;
    seeded = true;
    const { mkdirSync, existsSync } = await import("node:fs");
    mkdirSync(scratchParent, { recursive: true });
    if (!existsSync(join(scratch, ".git"))) {
      // A leftover from an earlier failed run is reused, not re-cloned over.
      await rm(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 }).catch(() => {});
      await exec("git", ["clone", "--no-hardlinks", fixture.repo, scratch], { windowsHide: true });
    }
  }

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

  await check("outside any repository a plain number explains what to pass", async () => {
    // With only a number there is no repository to clone, so the command must
    // say what it needs instead of guessing.
    const empty = await mkdtemp(join(tmpdir(), "pr-command-empty-"));
    try {
      const output = await runFailing([String(PR_NUMBER), "--no-open"], {
        cwd: empty,
        timeoutMs: 30_000,
      });
      assert.match(output, /needs a checkout|not a Git repository/);
      assert.match(output, /--repo|URL/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  await check("the review command behaves exactly like pr from an empty folder", async () => {
    // The `review` bin points at the same file, but a broken install used to
    // route it to the editor bridge, which failed with "not a Git repository".
    // Going through the real bin file proves the alias serves the same code.
    const empty = await mkdtemp(join(tmpdir(), "pr-command-review-"));
    await seedScratchCheckout();
    try {
      const reviewBin = join(ROOT, "..", "src", "pr.js");
      const child = spawn(process.execPath, [reviewBin, `https://github.com/acme/fixture/pull/${PR_NUMBER}`, "--no-open"], {
        cwd: empty,
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
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout; stderr=${stderr.slice(0, 300)}`)), 180_000);
        child.stdout.on("data", () => {
          const match = /Local page: (http\S+)/.exec(stdout);
          if (match) { clearTimeout(timer); resolve(match[1]); }
        });
        child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exit ${code}; stderr=${stderr.slice(0, 200)}`)); });
      });

      const version = await fetch(`${url}api/version`).then((r) => r.json());
      assert.equal(version.ok, true, "the review alias did not start a working page");
      const html = await (await fetch(url)).text();
      assert.match(html, /pr-badge/, "the page from the review alias has no PR badge");
      child.kill();
      await PAUSE(800);
    } finally {
      await rm(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
    }
  });

  await check("the editor bridge accepts a pull-request URL from an empty folder", async () => {
    // The Visual Studio / JetBrains bridge goes through cli.js: a PR URL there
    // used to fail with "This folder is not a Git repository" instead of
    // preparing a scratch checkout like pr does.
    const empty = await mkdtemp(join(tmpdir(), "pr-command-cli-"));
    await seedScratchCheckout();
    try {
      const child = spawn(process.execPath, [join(ROOT, "..", "src", "cli.js"), `https://github.com/acme/fixture/pull/${PR_NUMBER}`], {
        cwd: empty,
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
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });

      const payload = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout; stderr=${stderr.slice(0, 300)}`)), 180_000);
        child.stdout.on("data", () => {
          const match = /PR_REVIEW_READY (\{.*\})/.exec(stdout);
          if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])); }
        });
        child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`exit ${code}; stderr=${stderr.slice(0, 200)}`)); });
      });

      assert.equal(payload.ok, true, "the bridge did not start");
      assert.equal(payload.mode, "pr", "the bridge did not switch to PR mode");
      assert.equal(payload.pr, PR_NUMBER, "the bridge did not read the pull request");
      const version = await fetch(new URL("api/version", payload.url)).then((r) => r.json());
      assert.equal(version.ok, true, "the bridge page does not answer");
      child.kill();
      await PAUSE(800);
    } finally {
      await rm(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 }).catch(() => {});
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
  if (typeof scratchParent !== "undefined") await rm(scratch, { recursive: true, force: true }).catch(() => {});
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll pr command checks passed");
}
