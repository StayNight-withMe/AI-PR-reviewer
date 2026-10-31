/**
 * Review artifacts must not pollute the repository.
 *
 * Review artifacts live in the OS temp directory (or `PR_REVIEW_ARTIFACTS_DIR`),
 * never inside the checkout, so a review leaves the working tree clean.
 *
 * Run: node tests/artifacts.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { artifactsRoot, repoSlug, reviewDir } from "../src/artifacts.js";
import { MODE } from "../src/config.js";
const exec = promisify(execFile);
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}
async function makeRepo() {
  const root = await mkdtemp(join(tmpdir(), "artifacts-"));
  const git = (...a) => exec("git", a, { cwd: root });
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "t@e.com");
  await git("config", "user.name", "T");
  await writeFile(join(root, "a.txt"), "one\n");
  await git("add", "-A");
  await git("commit", "-m", "init");
  await writeFile(join(root, "a.txt"), "two\n");
  return root;
}
