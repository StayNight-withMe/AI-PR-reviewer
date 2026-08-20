/**
 * `mode=pr` against a mock `gh` and a real local git remote.
 *
 * No network, no GitHub account, no real repository: the fixture builds a real
 * git repo with a bare "origin" that carries `refs/pull/<n>/head`, and the mock
 * `gh` answers from a JSON database. That makes every PR path deterministic and
 * lets the test assert exact file sets instead of "some files".
 *
 * Run: node tests/pr-mode.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER, FORK_PR_NUMBER, REMOTE_PR_NUMBER, FORK_ONLY_PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { buildReview, startReview } from "../src/core.js";
import { MODE, ROUTES, GH } from "../src/config.js";
import { viewPullRequest, pullRequestScope, ghCommand, listPullRequests } from "../src/github.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const MOCK_GH = join(ROOT, "fixtures", "mock-gh.mjs");
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
const fixture = await createPrFixture();
/** Points the engine at the mock gh and its database. */
async function useMockGh(db) {
  const dir = await mkdtemp(join(tmpdir(), "pr-review-ghdb-"));
  const path = join(dir, "db.json");
  await writeFile(path, JSON.stringify(db), "utf8");
  process.env[GH.ENV_BIN] = MOCK_GH;
  process.env.MOCK_GH_DB = path;
  return { dir, path };
}
const db = {
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: {
    [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER),
    [String(FORK_PR_NUMBER)]: pullRequestPayload(fixture, FORK_PR_NUMBER),
    [String(REMOTE_PR_NUMBER)]: pullRequestPayload(fixture, REMOTE_PR_NUMBER),
    [String(FORK_ONLY_PR_NUMBER)]: pullRequestPayload(fixture, FORK_ONLY_PR_NUMBER),
  },
};
const ghDb = await useMockGh(db);
/** The ref values a review must never touch. */
async function remoteRefValues() {
  const { stdout } = await exec(fixture.binary, ["for-each-ref", "--format=%(refname) %(objectname)", "refs/remotes"], { cwd: fixture.repo });
  return stdout.trim();
}
try {
  await check("ghCommand runs a .mjs wrapper through node", () => {
    assert.equal(ghCommand({ [GH.ENV_BIN]: "C:/x/gh.exe" }).file, "C:/x/gh.exe");
    const script = ghCommand({ [GH.ENV_BIN]: MOCK_GH });
    assert.equal(script.file, process.execPath);
    assert.deepEqual(script.prefix, [MOCK_GH]);
  });

  await check("viewPullRequest reads the mock and normalizes it", async () => {
    const pr = await viewPullRequest(fixture.repo, { number: PR_NUMBER });
    assert.equal(pr.number, PR_NUMBER);
    assert.equal(pr.baseRefName, "main");
    assert.equal(pr.headRefName, "feature/login");
    assert.equal(pr.baseOid, fixture.commits.bigCommit);
    assert.equal(pr.headOid, fixture.commits.f2);
    assert.equal(pr.author, "octocat");
  });

  await check("an unknown PR number fails with the gh message", async () => {
    await assert.rejects(viewPullRequest(fixture.repo, { number: 999 }), /no pull requests found/i);
  });

  await check("an unauthenticated gh is reported as an auth error", async () => {
    await useMockGh({ ...db, auth: false });
    await assert.rejects(viewPullRequest(fixture.repo, { number: PR_NUMBER }), /auth|login|authentication/i);
    await useMockGh(db);
  });

  await check("without PR_REVIEW_GH a missing gh binary is reported clearly", async () => {
    const saved = process.env[GH.ENV_BIN];
    process.env[GH.ENV_BIN] = join(ghDb.dir, "does-not-exist.mjs");
    try {
      await assert.rejects(viewPullRequest(fixture.repo, { number: PR_NUMBER }), /did not start|Cannot find|not found/i);
    } finally {
      process.env[GH.ENV_BIN] = saved;
    }
  });

  await check("an exact PR review sees the whole change set", async () => {
    const review = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    const paths = review.files.map((f) => `${f.status} ${f.path}`).sort();

    assert.deepEqual(paths, [
      "added docs/new doc.md",
      "added src/login.ts",
      "deleted src/removed.ts",
      "modified data/with space.txt",
      "modified src/app.ts",
      "modified src/big.ts",
    ]);

    assert.equal(review.files.length, 6);
    assert.equal(review.meta.base, fixture.commits.bigCommit);
    assert.equal(review.meta.head, fixture.commits.f2);
    assert.equal(review.meta.pr.number, PR_NUMBER);
    assert.equal(review.meta.title, `PR #${PR_NUMBER}: Add the login module`);
    assert.equal(review.meta.branch, "feature/login");
  });

  await check("the review is pinned to the PR head, not the checked-out branch", async () => {
    // The checkout is on main; the PR head commit is not checked out at all.
    const head = (await exec(fixture.binary, ["rev-parse", "HEAD"], { cwd: fixture.repo })).stdout.trim();
    assert.equal(head, fixture.commits.bigCommit, "the fixture must be checked out on the PR base");

    const review = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    const app = review.files.find((f) => f.path === "src/app.ts");
    assert.ok(app, "src/app.ts is missing");
    // The added line exists only in the PR head; the diff must show it.
    const added = app.hunks.flatMap((h) => h.rows).filter((r) => r.kind === "add").map((r) => r.content);
    assert.ok(added.some((line) => line.includes("ready = true")), `unexpected added lines: ${JSON.stringify(added)}`);
  });

  await check("file content and changed lines come from the PR head commit", async () => {
    const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: false });
    try {
      const response = await fetch(new URL(`${ROUTES.API_FILE}?path=${encodeURIComponent("src/app.ts")}`, started.url));
      assert.equal(response.status, 200);
      const payload = await response.json();

      const lines = payload.lines.join("\n");
      assert.ok(lines.includes("ready = true"), "the viewer read the base, not the PR head");
      assert.ok(!lines.includes("version = '1.0.0'"), "the viewer read an old revision");
      assert.deepEqual(
        payload.changed,
        [2],
        `the changed line set is wrong: ${JSON.stringify(payload.changed)}`,
      );
    } finally {
      await started.page.close();
    }
  });

  await check("a second PR with the same base is a different review", async () => {
    const one = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    const two = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: FORK_PR_NUMBER });

    assert.notEqual(one.meta.id, two.meta.id, "two PRs share one review id");
    assert.equal(two.files.length, 1);
    assert.equal(two.files[0].path, "src/other.ts");
  });

  await check("reviewing a PR never moves or creates a remote-tracking ref", async () => {
    const before = await remoteRefValues();
    await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER });
    await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: FORK_PR_NUMBER });
    await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: REMOTE_PR_NUMBER });
    const after = await remoteRefValues();
    assert.equal(after, before, "a PR review changed the user's remote refs");
  });

  await check("a branch review of the same repo still sees its own diff", async () => {
    // Regression: fetching a PR base moved origin/<base>, which
    // emptied every branch review. The fixture's branch has commits.
    await exec(fixture.binary, ["checkout", "-b", "local-work"], { cwd: fixture.repo });
    await writeFile(join(fixture.repo, "local.txt"), "local\n");
    await exec(fixture.binary, ["add", "-A"], { cwd: fixture.repo });
    await exec(fixture.binary, ["commit", "-m", "local work"], { cwd: fixture.repo });

    const review = await buildReview({ repoPath: fixture.repo, mode: MODE.BRANCH, base: "origin/main" });
    assert.ok(review.files.some((f) => f.path === "local.txt"), "the branch review lost its own file");
    assert.ok(review.files.length >= 1);
  });

  await check("PR refs stay in the private namespace", async () => {
    // A fresh clone of the fixture never saw the PR heads: reviewing #10 must
    // fetch, and the fetch must land in refs/pr-review/…, never refs/remotes/.
    // `--no-local` is essential: a plain clone of a local path hardlinks the
    // whole object store, so the PR head would already be present and the fetch
    // path (the thing under test) would never run.
    const reviewer = join(fixture.root, "reviewer");
    await exec(fixture.binary, ["clone", "--no-local", fixture.origin, reviewer], { cwd: fixture.root });
    await exec(fixture.binary, ["config", "user.email", "r@e.com"], { cwd: reviewer });
    await exec(fixture.binary, ["config", "user.name", "R"], { cwd: reviewer });

    const review = await buildReview({ repoPath: reviewer, mode: MODE.PR, pr: FORK_ONLY_PR_NUMBER });
    assert.equal(review.meta.head, fixture.commits.k1, "the fork-only PR head was not fetched");
    assert.ok(review.files.some((f) => f.path === "fork-only.txt"), "the PR file is missing");

    const refs = (await exec(fixture.binary, ["for-each-ref", "--format=%(refname)", "refs/pr-review"], { cwd: reviewer })).stdout
      .split("\n").filter(Boolean);
    assert.ok(refs.length > 0, "no PR ref was created by the fetch");
    assert.ok(refs.every((ref) => ref.startsWith("refs/pr-review/")), `a PR ref leaked out of its namespace: ${refs.join(", ")}`);

    const remoteRefs = (await exec(fixture.binary, ["for-each-ref", "--format=%(refname)", "refs/remotes"], { cwd: reviewer })).stdout
      .split("\n").filter(Boolean);
    assert.ok(!remoteRefs.some((ref) => ref.includes("pr-review")), "a PR ref leaked into refs/remotes");
  });

  await check("a PR whose history shares no ancestor with the base still diffs", async () => {
    // GitHub diffs base..head (two-dot). A three-dot diff (merge-base) is EMPTY
    // when the head has no common ancestor with the base — an earlier version showed
    // an empty review for such a PR.
    const review = await buildReview({ repoPath: fixture.repo, mode: MODE.PR, pr: REMOTE_PR_NUMBER });
    assert.ok(review.files.length > 0, "the diff is empty for a PR without a shared ancestor");
    assert.ok(review.files.some((f) => f.path === "remote-only.txt"), "the PR file is missing");
  });

  await check("the review page shows the PR badge and escapes its title", async () => {
    const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: false });
    try {
      const html = await (await fetch(started.url)).text();
      assert.ok(html.includes('class="pr-badge"'), "the PR badge is missing");
      assert.ok(html.includes(`#${PR_NUMBER}`), "the PR number is missing from the header");
      assert.ok(html.includes(`https://github.com/acme/fixture/pull/${PR_NUMBER}`), "the PR link is missing");
    } finally {
      await started.page.close();
    }
  });

  await check("a title with HTML is escaped, not injected", async () => {
    const evil = { ...db, pullRequests: { ...db.pullRequests, "9": { ...pullRequestPayload(fixture, PR_NUMBER), number: 9, title: '<img src=x onerror="alert(1)">' } } };
    await useMockGh(evil);
    try {
      const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: 9, port: 0, dispatchEnabled: false, symbols: false });
      try {
        const html = await (await fetch(started.url)).text();
        assert.ok(!html.includes("<img src=x"), "the title was injected into the page");
        assert.ok(html.includes("&lt;img"), "the title was not escaped");
      } finally {
        await started.page.close();
      }
    } finally {
      await useMockGh(db);
    }
  });

  await check("listPullRequests lists the PRs and normalizes them", async () => {
    const prs = await listPullRequests(fixture.repo, { limit: 10 });
    assert.ok(prs.length >= 2, `expected the fixture PRs, got ${prs.length}`);
    const seven = prs.find((pr) => pr.number === PR_NUMBER);
    assert.ok(seven, "PR #7 is missing from the list");
    assert.equal(seven.headRefName, "feature/login");
    assert.equal(seven.author, "octocat");
    assert.ok(seven.url.endsWith(`/pull/${PR_NUMBER}`));
  });

  await check("listPullRequests sorts by newest and honours the limit", async () => {
    const prs = await listPullRequests(fixture.repo, { limit: 1 });
    assert.equal(prs.length, 1, "the limit was not applied");
  });

  await check("the scope key names the PR, not the commit pair", async () => {    const pr = await viewPullRequest(fixture.repo, { number: PR_NUMBER });
    assert.equal(pullRequestScope(pr), `pr${PR_NUMBER}`);
  });

  await check("md and json artifacts carry the PR metadata", async () => {
    const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: false });
    try {
      const submitted = await fetch(new URL(ROUTES.API_REVIEW, started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reviewState: "REQUEST_CHANGES",
          reviewBody: "Please fix the login.",
          summary: { files: 5, additions: 4, deletions: 2, comments: 1 },
          comments: [{ path: "src/app.ts", side: "right", lineStart: 2, lineEnd: 2, body: "Why this flag?" }],
        }),
      });
      assert.equal(submitted.status, 200);

      const saved = JSON.parse(await readFile(join(started.outputDir, "review.json"), "utf8"));
      assert.equal(saved.meta.pr.number, PR_NUMBER);
      assert.equal(saved.meta.pr.url, `https://github.com/acme/fixture/pull/${PR_NUMBER}`);
      assert.equal(saved.review.comments.length, 1);

      const markdown = await readFile(join(started.outputDir, "review.md"), "utf8");
      assert.ok(markdown.includes("## Pull request"), "the Markdown has no PR section");
      assert.ok(markdown.includes(`#${PR_NUMBER}`), "the Markdown does not name the PR");
    } finally {
      await started.page.close();
    }
  });

  await check("a submit without a summary still produces a review", async () => {
    // A minimal API client (or an older page) may omit `summary`; the server
    // The server must accept a submit that omits `summary`.
    const started = await startReview({ repoPath: fixture.repo, mode: MODE.PR, pr: PR_NUMBER, port: 0, dispatchEnabled: false, symbols: false });
    try {
      const submitted = await fetch(new URL(ROUTES.API_REVIEW, started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewState: "COMMENT", reviewBody: "", comments: [] }),
      });
      assert.equal(submitted.status, 200, "a submit without a summary must not fail");

      const markdown = await readFile(join(started.outputDir, "review.md"), "utf8");
      assert.ok(markdown.includes("# Review:"), "no Markdown was produced");
      assert.ok(markdown.includes("_No inline comments._"));
    } finally {
      await started.page.close();
    }
  });
} finally {
  delete process.env[GH.ENV_BIN];
  delete process.env.MOCK_GH_DB;
  await rm(ghDb.dir, { recursive: true, force: true }).catch(() => {});
  await fixture.cleanup();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll PR-mode checks passed");
}
