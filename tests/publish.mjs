/**
 * Publishing a locally written review back to GitHub as a real PR review.
 *
 * Everything runs against the mock `gh` and a local fixture, so no network and
 * no GitHub account are involved. The mock records what it was asked to post,
 * and the test reads it back.
 *
 * Run: node tests/publish.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { publishReview, toGitHubComment, toGitHubReview } from "../src/github.js";
import { GH } from "../src/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "pr-review-publish-"));
const dbPath = join(dbDir, "db.json");

async function resetDb(overrides = {}) {
  await writeFile(dbPath, JSON.stringify({
    auth: true,
    default: String(PR_NUMBER),
    pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
    ...overrides,
  }));
}

process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;

const pr = { number: PR_NUMBER, url: `https://github.com/o/r/pull/${PR_NUMBER}`, repo: "o/r" };
const readDb = async () => JSON.parse(await readFile(dbPath, "utf8"));

/* ------------------------------- pure mapping ------------------------------ */

await check("a line comment becomes a GitHub inline comment", () => {
  const mapped = toGitHubComment({ path: "a.cs", side: "right", lineStart: 10, lineEnd: 10, body: "rename this" });
  assert.deepEqual(mapped, { path: "a.cs", body: "rename this", side: "RIGHT", line: 10 });
});

await check("a multi-line comment carries its range", () => {
  const mapped = toGitHubComment({ path: "a.cs", side: "right", lineStart: 10, lineEnd: 14, body: "this block" });
  assert.equal(mapped.line, 14);
  assert.equal(mapped.start_line, 10);
  assert.equal(mapped.start_side, "RIGHT");
});

await check("a comment on the old side uses the left side", () => {
  const mapped = toGitHubComment({ path: "a.cs", side: "left", lineStart: 3, lineEnd: 3, body: "gone" });
  assert.equal(mapped.side, "LEFT");
  assert.equal(mapped.line, 3);
});

await check("a comment without a line is moved into the review body", () => {
  const payload = toGitHubReview({
    reviewState: "COMMENT",
    reviewBody: "Overview",
    comments: [{ path: "b.cs", side: "right", lineStart: 0, lineEnd: 0, body: "file level" }],
  });
  assert.equal(payload.comments.length, 0, "a file-level comment cannot be inline");
  assert.match(payload.body, /file level/);
  assert.match(payload.body, /Overview/);
});

await check("an unknown verdict falls back to COMMENT", () => {
  assert.equal(toGitHubReview({ reviewState: "LGTM" }).state, "COMMENT");
});

/* ----------------------------- publishing ---------------------------------- */

await check("a review with inline comments goes through the API", async () => {
  await resetDb();
  const result = await publishReview(fixture.repo, {
    pr,
    review: {
      reviewState: "REQUEST_CHANGES",
      reviewBody: "Fix these two.",
      comments: [
        { path: "src/app.cs", side: "right", lineStart: 5, lineEnd: 5, body: "one" },
        { path: "src/app.cs", side: "right", lineStart: 9, lineEnd: 11, body: "two" },
      ],
    },
  });

  assert.equal(result.published, true);
  assert.equal(result.state, "REQUEST_CHANGES");
  assert.equal(result.inlineComments, 2);
  assert.match(result.url, /pull\/\d+#pullrequestreview-/);

  const db = await readDb();
  const posted = db.publishedReviews.at(-1);
  assert.equal(posted.number, String(PR_NUMBER));
  assert.equal(posted.event, "REQUEST_CHANGES");
  assert.equal(posted.body, "Fix these two.");
  assert.equal(posted.comments.length, 2);
  assert.deepEqual(posted.comments[0], { path: "src/app.cs", body: "one", side: "RIGHT", line: 5 });
  assert.equal(posted.comments[1].start_line, 9);
  assert.equal(posted.comments[1].line, 11);
});

await check("an approval with no comments uses the simple CLI", async () => {
  await resetDb();
  const result = await publishReview(fixture.repo, {
    pr,
    review: { reviewState: "APPROVE", reviewBody: "Looks good.", comments: [] },
  });

  assert.equal(result.state, "APPROVE");
  assert.equal(result.inlineComments, 0);

  const posted = (await readDb()).publishedReviews.at(-1);
  assert.equal(posted.event, "APPROVE");
  assert.equal(posted.body, "Looks good.");
});

await check("a request-changes with only a body also uses the CLI", async () => {
  await resetDb();
  const result = await publishReview(fixture.repo, {
    pr,
    review: { reviewState: "REQUEST_CHANGES", reviewBody: "Rename it.", comments: [] },
  });
  assert.equal(result.state, "REQUEST_CHANGES");
  assert.equal((await readDb()).publishedReviews.at(-1).event, "REQUEST_CHANGES");
});

await check("publishing without a pull request is refused clearly", async () => {
  await resetDb();
  await assert.rejects(
    () => publishReview(fixture.repo, { pr: null, review: { reviewState: "COMMENT", comments: [] } }),
    /not about a pull request/,
  );
});

await check("a logged-out gh is reported, not silently ignored", async () => {
  await resetDb({ auth: false });
  await assert.rejects(
    () => publishReview(fixture.repo, {
      pr,
      review: { reviewState: "COMMENT", reviewBody: "hi", comments: [] },
    }),
    /not authenticated|gh auth login/i,
  );
});

await check("a review that GitHub rejects reports its message", async () => {
  // A closed PR is what GitHub refuses, and gh passes the reason through.
  await resetDb({ pullRequests: {} });
  await assert.rejects(
    () => publishReview(fixture.repo, {
      pr: { number: 999, url: "", repo: "o/r" },
      review: { reviewState: "APPROVE", reviewBody: "ok", comments: [] },
    }),
    /no pull request|rejected|mock/i,
  );
});

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll publish checks passed");
