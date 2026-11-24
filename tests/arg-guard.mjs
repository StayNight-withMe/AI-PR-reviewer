
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { safeRef, searchProject } from "../src/git.js";
import { GIT, MODE, ROUTES } from "../src/config.js";

const exec = promisify(execFile);
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const root = await mkdtemp(join(tmpdir(), "pr-review-args-"));
const repo = join(root, "repo");
const git = (...args) => exec(GIT.BIN, args, { cwd: repo });

try {
  await exec(GIT.BIN, ["init", "--initial-branch", "main", repo]);
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src", "a.ts"), "export const inside = 1;\n");
  await writeFile(join(repo, "src", "b.ts"), "the --cached flag is documented here\n");
  await git("add", "-A");
  await git("commit", "-m", "first");
  await writeFile(join(repo, "src", "a.ts"), "export const inside = 1;\nexport const more = 2;\n");
  await git("commit", "-am", "second");
  const head = (await git("rev-parse", "HEAD")).stdout.trim();


  const proof = join(root, "search-ran.txt");
  await writeFile(join(repo, "run.sh"), `#!/bin/sh\necho RAN > '${proof}'\n`);

  await check("a revision that looks like an option is refused", () => {
    for (const bad of ["--output=/tmp/x", "-O./run.sh", "--upload-pack=calc", "-n", "--", ""]) {
      assert.throws(() => safeRef(bad), /Not a valid revision/, `${bad} was accepted`);
    }
  });

  await check("real revisions are still accepted", () => {
    const good = ["HEAD", head, "HEAD~1", "origin/main", "main", "abc1234", "HEAD^", "v1.0.0", "refs/heads/main", "HEAD@{1}"];
    for (const value of good) assert.equal(safeRef(value), value, `${value} was refused`);
    assert.equal(safeRef("  HEAD  "), "HEAD", "surrounding spaces were not trimmed");
  });

  await check("a search query cannot run a script", async () => {
    const hits = await searchProject(repo, "-O./run.sh");
    assert.deepEqual(hits, [], "the option-shaped query returned hits");
    const ran = await readFile(proof, "utf8").catch(() => null);
    assert.equal(ran, null, "the query made git run a script");
  });

  await check("a search still finds text that starts with a dash", async () => {
    const hits = await searchProject(repo, "--cached");
    assert.ok(
      hits.some((hit) => hit.path === "src/b.ts"),
      `a real dash-leading search found nothing: ${JSON.stringify(hits)}`,
    );
  });

  for (const name of ["OPENCODE_SESSION_ID", "OPENCODE_SESSION"]) delete process.env[name];
  process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");

  const review = await startReview({
    repoPath: repo, mode: MODE.RANGE, base: "HEAD~1", head: "HEAD",
    port: 0, symbols: false, dispatchEnabled: false, sessionId: "",
  });

  const victim = join(root, "victim.txt");
  const get = async (route, params) => {
    const url = new URL(route, review.url);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url);
    return { status: response.status, body: await response.text() };
  };

  await check("no route writes a file through a crafted revision", async () => {
    const attempts = [
      [ROUTES.API_RANGE, { from: `--output=${victim}`, to: "HEAD" }],
      [ROUTES.API_RANGE, { from: "HEAD~1", to: `--output=${victim}` }],
      [ROUTES.API_COMMIT, { sha: `--output=${victim}` }],
      [ROUTES.API_BRANCH_COMMITS, { branch: `--output=${victim}` }],
    ];

    for (const [route, params] of attempts) {
      await writeFile(victim, "ORIGINAL\n");
      const answer = await get(route, params);
      assert.ok(answer.status >= 400, `${route} answered ${answer.status}`);
      assert.match(answer.body, /Not a valid revision/, `${route} did not explain the refusal`);
      assert.equal(await readFile(victim, "utf8"), "ORIGINAL\n", `${route} overwrote a file`);
    }
  });

  await check("no route runs a script through the search query", async () => {
    await rm(proof, { force: true });
    const answer = await get(ROUTES.API_SEARCH, { q: "-O./run.sh" });
    assert.equal(answer.status, 200, "the search failed instead of returning nothing");
    assert.equal(await readFile(proof, "utf8").catch(() => null), null, "the search ran a script");
  });

  await check("real ranges and commits still load", async () => {
    const range = await get(ROUTES.API_RANGE, { from: "HEAD~1", to: "HEAD" });
    assert.equal(range.status, 200, `a real range failed: ${range.body.slice(0, 120)}`);
    const files = JSON.parse(range.body).files.map((file) => file.path);
    assert.deepEqual(files, ["src/a.ts"], `the range shows the wrong files: ${JSON.stringify(files)}`);

    const commit = await get(ROUTES.API_COMMIT, { sha: head });
    assert.equal(commit.status, 200, `a real commit failed: ${commit.body.slice(0, 120)}`);

    const branch = await get(ROUTES.API_BRANCH_COMMITS, { branch: "main" });
    assert.equal(branch.status, 200, `a real branch failed: ${branch.body.slice(0, 120)}`);

    const search = await get(ROUTES.API_SEARCH, { q: "inside" });
    assert.equal(search.status, 200);
    assert.ok(JSON.parse(search.body).hits.length > 0, "a real search found nothing");
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
console.log("\nAll argument-guard checks passed");
