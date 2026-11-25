
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrFixture, pullRequestPayload, PR_NUMBER } from "./fixtures/pr-fixture.mjs";
import { startReview } from "../src/core.js";
import { MODE, GH } from "../src/config.js";
import { pullRequestViewedFiles, setPullRequestFileViewed } from "../src/github.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const failures = [];

function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

const fixture = await createPrFixture();
const dbDir = await mkdtemp(join(tmpdir(), "pr-review-viewed-"));
const dbPath = join(dbDir, "db.json");
await writeFile(dbPath, JSON.stringify({
  auth: true,
  default: String(PR_NUMBER),
  pullRequests: { [String(PR_NUMBER)]: pullRequestPayload(fixture, PR_NUMBER) },
  viewed: {},
}));
process.env[GH.ENV_BIN] = join(ROOT, "fixtures", "mock-gh.mjs");
process.env.MOCK_GH_DB = dbPath;

const pr = { repo: "acme/shop", number: PR_NUMBER };

try {
  await check("GitHub returns the viewed state of the pull-request files", async () => {
    await setPullRequestFileViewed(fixture.repo, { pullRequestId: "PR_mock_7", path: "src/login.ts", viewed: true });
    const snapshot = await pullRequestViewedFiles(fixture.repo, pr.repo, pr.number);
    assert.equal(snapshot.files["src/login.ts"], "VIEWED", "the viewed file is not reported");
    assert.equal(snapshot.id, "PR_mock_7", "the pull request id is missing");
    assert.equal(snapshot.truncated, false);
  });

  await check("unmarking a file really clears it on GitHub", async () => {
    await setPullRequestFileViewed(fixture.repo, { pullRequestId: "PR_mock_7", path: "src/login.ts", viewed: false });
    const snapshot = await pullRequestViewedFiles(fixture.repo, pr.repo, pr.number);
    assert.equal(snapshot.files["src/login.ts"], "UNVIEWED", "the file is still viewed");
  });

  await check("the page serves the GitHub viewed state and writes it back", async () => {
    const started = await startReview({
      repoPath: fixture.repo,
      mode: MODE.PR,
      pr: PR_NUMBER,
      port: 0,
      dispatchEnabled: false,
      symbols: false,
    });

    try {
      const path = "src/login.ts";

      const before = await fetch(new URL("/api/viewed", started.url)).then((r) => r.json());
      assert.equal(before.ok, true, "the endpoint did not answer");
      assert.equal(before.available, true, "the endpoint reports no GitHub access");
      assert.equal(before.id, "PR_mock_7");

      const written = await fetch(new URL("/api/viewed", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, viewed: true }),
      }).then((r) => r.json());
      assert.equal(written.ok, true, `the write failed: ${written.error}`);

      const after = await fetch(new URL("/api/viewed", started.url)).then((r) => r.json());
      assert.equal(after.files[path], "VIEWED", "GitHub did not keep the mark");

      const cleared = await fetch(new URL("/api/viewed", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, viewed: false }),
      }).then((r) => r.json());
      assert.equal(cleared.ok, true, `the unmark failed: ${cleared.error}`);

      const finalState = await fetch(new URL("/api/viewed", started.url)).then((r) => r.json());
      assert.notEqual(finalState.files[path], "VIEWED", "the file is still viewed after clearing");
    } finally {
      await started.page.close();
    }
  });

  await check("a file outside the pull request is refused before GitHub is called", async () => {
    const started = await startReview({
      repoPath: fixture.repo,
      mode: MODE.PR,
      pr: PR_NUMBER,
      port: 0,
      dispatchEnabled: false,
      symbols: false,
    });

    try {
      const response = await fetch(new URL("/api/viewed", started.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "not/in/the/pr.txt", viewed: true }),
      });
      const result = await response.json();
      assert.equal(result.ok, false, "an unknown path was accepted");
      assert.match(result.error, /not a file of this pull request/i);
    } finally {
      await started.page.close();
    }
  });

  await check("a review that is not a pull request has no viewed sync", async () => {
    const started = await startReview({
      repoPath: fixture.repo,
      mode: MODE.UNCOMMITTED,
      port: 0,
      dispatchEnabled: false,
      symbols: false,
    });

    try {
      const result = await fetch(new URL("/api/viewed", started.url)).then((r) => r.json());
      assert.equal(result.available, false, "a non-PR review claims viewed sync");
      assert.deepEqual(result.files, {});
    } finally {
      await started.page.close();
    }
  });
} finally {
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const failure of failures) console.log(`  ${failure}`);
  } else {
    console.log("\nAll viewed-sync checks passed");
  }
  process.exit(failures.length ? 1 : 0);
}
