/**
 * The GitHub pull-request scope (`mode=pr`).
 *
 * A PR is reviewed through the GitHub CLI, so this test has two layers:
 *
 *   1. Pure: the `gh pr view --json` payload maps onto the fields the page
 *      uses, and the review id / title derive from it. No network, no gh.
 *   2. Live, skipped when `gh` is missing or unauthenticated: a real PR on a
 *      real repository is read and turned into a range review.
 *
 * The live layer picks a repository from the environment (PR_REVIEW_TEST_REPO)
 * or the current checkout, and a PR number that `gh pr list` returns. When no
 * PR is reachable the layer reports "skipped" instead of failing: a checkout
 * without PRs is normal, not a broken build.
 *
 * Run: node tests/github.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePullRequest,
  pullRequestScope,
  pullRequestTitle,
  ghBinary,
} from "../src/github.js";
import { GH, MODE } from "../src/config.js";
const exec = promisify(execFile);
const ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT = `${ROOT}/..`;
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
