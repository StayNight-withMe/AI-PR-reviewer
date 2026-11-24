
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GIT, SERVER } from "../src/config.js";

const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVE = join(ROOT, "..", "scripts", "serve-5454.js");
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}


function runServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVE, env.__repo, "0", "uncommitted"], {
      cwd: join(ROOT, ".."),
      env: { ...process.env, ...env },
      windowsHide: true,
    });

    let out = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(out);
    }, 8000);

    child.stdout.on("data", (chunk) => {
      out += chunk;


      if (out.includes("ARTIFACT_DIR=")) {
        clearTimeout(timer);
        child.kill();
        resolve(out);
      }
    });
    child.stderr.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
  });
}

const root = await mkdtemp(join(tmpdir(), "pr-review-session-leak-"));
try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main"], { cwd: root });
  await exec(GIT.BIN, ["config", "user.email", "test@example.com"], { cwd: root });
  await exec(GIT.BIN, ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "a.txt"), "one\n");
  await exec(GIT.BIN, ["add", "-A"], { cwd: root });
  await exec(GIT.BIN, ["commit", "-m", "init"], { cwd: root });
  await writeFile(join(root, "a.txt"), "two\n");

  const dirOf = (output) => {
    const match = /ARTIFACT_DIR=(.+)/.exec(output);
    return match ? match[1].trim() : null;
  };
  const ownerOf = async (dir) => {
    try {
      return JSON.parse(await readFile(join(dir, "session.json"), "utf8")).sessionId;
    } catch {
      return null;
    }
  };

  await check("a page started with a chat session in the environment does not claim it", async () => {
    const output = await runServer({
      __repo: root,
      OPENCODE_SESSION_ID: "ses_this_is_someone_elses_chat",
      PR_REVIEW_SESSION: "",
    });
    const dir = dirOf(output);
    assert.ok(dir, `the server printed no artifact dir:\n${output}`);
    const owner = await ownerOf(dir);
    assert.ok(!owner, `the review was assigned to an unrelated session: ${owner}`);
  });

  await check("an explicitly passed session is still recorded", async () => {
    const output = await runServer({
      __repo: root,
      OPENCODE_SESSION_ID: "ses_unrelated",
      PR_REVIEW_SESSION: "ses_the_real_owner",
    });
    const dir = dirOf(output);
    assert.ok(dir, "the server printed no artifact dir");
    assert.equal(await ownerOf(dir), "ses_the_real_owner");
  });
} finally {
  await rm(root, { recursive: true, force: true });
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll session-isolation checks passed");
