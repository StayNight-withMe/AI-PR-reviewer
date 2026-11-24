
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { renameCommit } from "../src/git.js";
import { GIT, MODE, ROUTES } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}


async function makeRepo(root) {
  const repo = join(root, "repo");
  const git = async (...args) => (await exec(GIT.BIN, args, { cwd: repo })).stdout.trim();
  const commit = async (file, body, message) => {
    await writeFile(join(repo, file), body);
    await git("add", "-A");
    await git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  };

  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");

  await commit("main.txt", "main\n", "main work");
  await git("checkout", "-q", "-b", "side");
  const sideSha = await commit("side.txt", "side\n", "side work");
  await git("checkout", "-q", "main");
  await commit("more.txt", "more\n", "main again");
  await git("checkout", "-q", "side");
  await commit("side.txt", "side\nmore side\n", "side again");
  await git("checkout", "-q", "main");

  return { repo, git, sideSha };
}

const root = await mkdtemp(join(tmpdir(), "pr-review-rename-"));

try {
  const { repo, git, sideSha } = await makeRepo(root);

  await check("a commit from another branch is refused, and nothing moves", async () => {
    const before = {
      branch: await git("branch", "--show-current"),
      head: await git("rev-parse", "HEAD"),
      side: await git("rev-parse", "side"),
      files: (await git("ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean),
      status: await git("status", "--porcelain"),
    };

    await assert.rejects(
      () => renameCommit(repo, sideSha, "side work, renamed"),
      /not on the checked-out branch/,
      "a commit from another branch was rewritten",
    );

    const after = {
      branch: await git("branch", "--show-current"),
      head: await git("rev-parse", "HEAD"),
      side: await git("rev-parse", "side"),
      files: (await git("ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean),
      status: await git("status", "--porcelain"),
    };

    assert.deepEqual(after, before, "the repository changed while the rename was refused");
    assert.ok(!after.files.includes("side.txt"), "another branch's file entered the working tree");
  });

  await check("the head commit is renamed in place", async () => {
    const before = await git("rev-parse", "HEAD");
    const result = await renameCommit(repo, before, "main again, renamed");
    assert.notEqual(result, before, "the commit did not change");
    assert.equal(await git("log", "-1", "--format=%s"), "main again, renamed");
    assert.equal(await git("branch", "--show-current"), "main", "the rename left HEAD detached");
  });

  await check("an ancestor is renamed and its descendants replayed", async () => {
    const list = await git("log", "--format=%H %s").then((out) => out.split("\n").map((line) => line.split(" ")));
    const first = list.find(([, ...subject]) => subject.join(" ") === "main work");
    assert.ok(first, "the first commit is missing");

    await renameCommit(repo, first[0], "main work, renamed");
    const subjects = (await git("log", "--format=%s")).split("\n");
    assert.deepEqual(subjects, ["main again, renamed", "main work, renamed"], `unexpected history: ${JSON.stringify(subjects)}`);
    assert.equal(await git("branch", "--show-current"), "main", "the replay left HEAD detached");


    const files = (await git("ls-tree", "--name-only", "HEAD")).split("\n").filter(Boolean).sort();
    assert.deepEqual(files, ["main.txt", "more.txt"]);
  });

  await check("an unknown sha is refused", async () => {
    await assert.rejects(
      () => renameCommit(repo, "0123456789abcdef0123456789abcdef01234567", "nope"),
      /Commit not found/,
    );
  });

  await check("a sha that looks like an option writes no file", async () => {
    const victim = join(root, "victim.txt");
    await writeFile(victim, "ORIGINAL\n");
    await assert.rejects(
      () => renameCommit(repo, `--output=${victim}`, "x"),
      /Not a valid revision/,
    );
    const { readFile } = await import("node:fs/promises");
    assert.equal(await readFile(victim, "utf8"), "ORIGINAL\n", "the sha was read as a git option");
  });


  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  const review = await startReview({
    repoPath: repo, mode: MODE.UNCOMMITTED, port: 0, symbols: false,
    dispatchEnabled: false, sessionId: "",
  });

  const rename = async (payload) => {
    const response = await fetch(new URL(ROUTES.API_COMMIT_RENAME, review.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, payload: await response.json().catch(() => null) };
  };

  await check("the rename route refuses another branch's commit", async () => {
    const before = await git("rev-parse", "HEAD");
    const answer = await rename({ sha: sideSha, message: "hijacked" });
    assert.ok(answer.status >= 400, `the route accepted it: ${answer.status}`);
    assert.match(answer.payload.error, /not on the checked-out branch/);
    assert.equal(await git("rev-parse", "HEAD"), before, "the repository moved");
    assert.equal(await git("branch", "--show-current"), "main", "HEAD was left detached");
  });

  await check("the rename route still renames the head commit", async () => {
    const head = await git("rev-parse", "HEAD");
    const answer = await rename({ sha: head, message: "renamed from the page" });
    assert.equal(answer.status, 200, `the route failed: ${JSON.stringify(answer.payload)}`);
    assert.equal(await git("log", "-1", "--format=%s"), "renamed from the page");
  });

  await check("the rename route refuses an empty message", async () => {
    const answer = await rename({ sha: await git("rev-parse", "HEAD"), message: "   " });
    assert.equal(answer.status, 400, `an empty message was accepted: ${answer.status}`);
  });

  await review.page.close();
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
  delete process.env[GIT.ARTIFACTS_DIR_ENV];
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll commit-rename checks passed");
