#!/usr/bin/env node
/**
 * A stand-in for the GitHub CLI, for tests.
 *
 * It speaks only the two commands the review engine uses — `gh pr view` and
 * `gh auth status` — and reads its data from a JSON "database" whose path is in
 * MOCK_GH_DB. That makes `mode=pr` testable with no network, no token and no
 * real GitHub account.
 *
 * The database shape:
 *   {
 *     "auth": true,                       // false => auth status fails
 *     "pullRequests": { "7": { ...fields in `gh pr view --json` shape } },
 *     "default": "7"                      // used when no number is given
 *   }
 *
 * A field missing from a PR entry is simply absent from the output, so the
 * engine's tolerance of a sparse payload is exercised too.
 *
 * Exit codes mirror gh: 0 on success, 1 on "no pull request", 2 on a bad call.
 */
import { readFile } from "node:fs/promises";
const argv = process.argv.slice(2);
function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}
if (argv[0] === "--version") {
  process.stdout.write("gh version 0.0.0-mock (mock)\n");
  process.exit(0);
}
