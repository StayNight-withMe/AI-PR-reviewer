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
/** Flags that take a value; the token after them is not a positional argument. */
const VALUED_FLAGS = new Set(["--method", "--input", "--repo", "--body", "--json", "--state", "--limit", "--body-file"]);
/** The first argument that is neither a flag nor a flag's value. */
function positionalArg(args, from) {
  for (let index = from; index < args.length; index += 1) {
    const token = args[index];
    if (token.startsWith("--")) {
      if (VALUED_FLAGS.has(token)) index += 1;
      continue;
    }
    return token;
  }
  return null;
}
/** `--approve` -> APPROVE, and so on. */
const FLAG_TO_EVENT = {
  "--approve": "APPROVE",
  "--request-changes": "REQUEST_CHANGES",
  "--comment": "COMMENT",
};
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
if (argv[0] === "pr" && argv[1] === "review") {
  // Publishing a review without inline comments: record what was sent.
  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);

  const number = positionalArg(argv, 2);
  const flag = ["--approve", "--request-changes", "--comment"].find((name) => argv.includes(name));
  if (!flag) fail("mock gh review: no verdict flag", 2);

  // GitHub refuses a review of a PR it does not have (or one that is closed).
  const known = db.pullRequests?.[String(number ?? db.default ?? "")];
  if (!known) fail(`no pull requests found for branch "${number ?? ""}"`, 1);

  const bodyIndex = argv.indexOf("--body");
  const body = bodyIndex === -1 ? "" : argv[bodyIndex + 1] ?? "";

  await recordReview(db, {
    number: String(number ?? db.default ?? ""),
    event: FLAG_TO_EVENT[flag],
    body,
    comments: [],
  });

  process.stdout.write(`Reviewed pull request #${number}\n`);
  process.exit(0);
}
if (argv[0] === "api") {
  // Publishing a review WITH inline comments: the payload arrives on stdin.
  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);

  const endpoint = positionalArg(argv, 1);
  const match = /repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/reviews$/.exec(String(endpoint ?? ""));
  if (!match) fail(`mock gh api: unsupported endpoint ${endpoint}`, 2);
  if (!argv.includes("--input")) fail("mock gh api: expected --input -", 2);

  // Same check as the CLI path: an unknown PR cannot be reviewed.
  if (!db.pullRequests?.[match[2]] && !Object.keys(db.pullRequests ?? {}).length) {
    fail(`no pull requests found for #${match[2]}`, 1);
  }

  const payload = JSON.parse(await readStdin());
  const entry = await recordReview(db, {
    repo: match[1],
    number: match[2],
    event: payload.event,
    body: payload.body ?? "",
    comments: payload.comments ?? [],
  });

  // The real API answers with the created review object.
  process.stdout.write(JSON.stringify({
    id: entry.id,
    html_url: `https://github.com/${match[1]}/pull/${match[2]}#pullrequestreview-${entry.id}`,
    body: entry.body,
    event: entry.event,
  }) + "\n");
  process.exit(0);
}
fail(`mock gh: unsupported command: ${argv.join(" ")}`, 2);
/** Appends the given review to the database file, so tests can assert on it. */
async function recordReview(db, review) {
  const published = Array.isArray(db.publishedReviews) ? db.publishedReviews : [];
  const entry = { id: published.length + 1, ...review, at: new Date().toISOString() };
  published.push(entry);
  db.publishedReviews = published;

  const body = JSON.stringify(db, null, 2);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(process.env.MOCK_GH_DB, body, "utf8");
  return entry;
}
/** Everything written to stdin (the `gh api --input -` payload). */
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
async function loadDb() {
  const path = process.env.MOCK_GH_DB;
  if (!path) fail("MOCK_GH_DB is not set", 2);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    fail(`mock gh: cannot read the database: ${error.message}`, 2);
  }
}
