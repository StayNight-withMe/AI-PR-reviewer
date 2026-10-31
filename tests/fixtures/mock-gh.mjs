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
if (argv[0] === "auth" && argv[1] === "status") {
  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);
  process.stdout.write("mock (logged in)\n");
  process.exit(0);
}
if (argv[0] === "pr" && argv[1] === "list") {
  const db = await loadDb();
  const jsonIndex = argv.indexOf("--json");
  if (jsonIndex === -1) fail("expected --json", 2);

  const stateIndex = argv.indexOf("--state");
  const state = stateIndex === -1 ? "open" : String(argv[stateIndex + 1]).toLowerCase();
  const limitIndex = argv.indexOf("--limit");
  const limit = limitIndex === -1 ? 30 : Number(argv[limitIndex + 1]);

  const all = Object.values(db.pullRequests ?? {});
  const wanted = all.filter((pr) => {
    if (state === "all") return true;
    const value = String(pr.state ?? "").toLowerCase();
    // `gh` maps merged PRs to state MERGED.
    if (state === "merged") return value === "merged";
    if (state === "closed") return value === "closed" || value === "merged";
    return value === "open";
  }).slice(0, Number.isFinite(limit) ? limit : 30);

  const fields = String(argv[jsonIndex + 1] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const payload = wanted.map((pr) => {
    const entry = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(pr, field)) entry[field] = pr[field];
    }
    return entry;
  });

  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(0);
}
if (argv[0] === "pr" && argv[1] === "view") {
  const db = await loadDb();
  const jsonIndex = argv.indexOf("--json");
  if (jsonIndex === -1) fail("expected --json", 2);

  const selector = argv.slice(2, jsonIndex).filter((token) => !token.startsWith("--"));
  const requested = selector[0] ?? db.default;
  const pr = db.pullRequests?.[String(requested)];
  if (!pr) fail(`no pull requests found for branch "${requested ?? ""}"`, 1);

  // Only the requested fields come back, exactly like gh.
  const fields = String(argv[jsonIndex + 1] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const payload = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(pr, field)) payload[field] = pr[field];
  }

  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(0);
}
