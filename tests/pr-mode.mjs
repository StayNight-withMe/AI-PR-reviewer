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
