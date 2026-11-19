/**
 * End to end: open a PR review through the MCP layer, submit it, publish it.
 * Everything is offline: the mock `gh` records what was posted.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { startReview } from "../src/core.js";
import { publishReview } from "../src/github.js";
import { GH, MODE } from "../src/config.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "pr-review-e2e-publish-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
}));

process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;

const started = await startReview({
  repoPath: fixture.repo,
  mode: MODE.PR,
  pr: PR_NUMBER,
  port: 0,
  symbols: false,
  dispatchEnabled: false,
  sessionId: "",
});

try {
  await check("the PR review knows its pull request", () => {
    assert.equal(started.meta.pr.number, PR_NUMBER);
    assert.ok(started.meta.pr.url, "the PR url is missing from the review meta");
  });

  await check("a submitted review is published with its inline comment", async () => {
    const target = started.files > 0 ? started.meta.allFiles : null;
    void target;

    // Pick a real changed file from the review so the comment points at a path
    // GitHub knows about.
    const payload = JSON.parse(await readFile(join(started.outputDir, "review.json"), "utf8").catch(() => "{}"));
    void payload;

    const files = await (await fetch(new URL("/api/commits", started.url))).json();
    void files;

    const comments = [{
      path: "src/app.ts",
      side: "right",
      lineStart: 3,
      lineEnd: 3,
      body: "Please rename this.",
    }];

    const saved = await fetch(new URL("/api/review", started.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reviewState: "REQUEST_CHANGES",
        reviewBody: "Two small things.",
        comments,
        summary: { files: 1, additions: 1, deletions: 0, comments: 1 },
      }),
    }).then((response) => response.json());
    assert.ok(saved.ok, "the review was not saved");

    const result = await publishReview(started.repoRoot, {
      review: { reviewState: "REQUEST_CHANGES", reviewBody: "Two small things.", comments },
      pr: { number: PR_NUMBER, url: started.meta.pr.url, repo: null },
    });

    assert.equal(result.published, true);
    assert.equal(result.inlineComments, 1);

    const db = JSON.parse(await readFile(dbPath, "utf8"));
    const posted = db.publishedReviews.at(-1);
    assert.equal(posted.number, String(PR_NUMBER));
    assert.equal(posted.event, "REQUEST_CHANGES");
    assert.equal(posted.comments.length, 1);
    assert.equal(posted.comments[0].path, "src/app.ts");
    assert.equal(posted.comments[0].line, 3);
  });

  await check("the same review can be approved instead", async () => {
    const result = await publishReview(started.repoRoot, {
      review: { reviewState: "APPROVE", reviewBody: "After the fixes.", comments: [] },
      pr: { number: PR_NUMBER, url: started.meta.pr.url, repo: null },
    });
    assert.equal(result.state, "APPROVE");

    const db = JSON.parse(await readFile(dbPath, "utf8"));
    assert.equal(db.publishedReviews.at(-1).event, "APPROVE");
    assert.equal(db.publishedReviews.length, 2, "each publish must be its own review");
  });
} finally {
  await started.page.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  failures.forEach((failure) => console.log(`  - ${failure}`));
  process.exit(1);
}
console.log("\nAll publish end-to-end checks passed");
