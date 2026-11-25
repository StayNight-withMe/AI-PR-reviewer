#!/usr/bin/env node

import { readFile } from "node:fs/promises";
const argv = process.argv.slice(2);

const VALUED_FLAGS = new Set(["--method", "--input", "--repo", "--body", "--json", "--state", "--limit", "--body-file"]);

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


  const fields = String(argv[jsonIndex + 1] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  const payload = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(pr, field)) payload[field] = pr[field];
  }

  process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(0);
}
if (argv[0] === "pr" && argv[1] === "review") {

  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);

  const number = positionalArg(argv, 2);
  const flag = ["--approve", "--request-changes", "--comment"].find((name) => argv.includes(name));
  if (!flag) fail("mock gh review: no verdict flag", 2);


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
if (argv[0] === "api" && argv[1] === "graphql") {
  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);
  if (!argv.includes("--input")) fail("mock gh api graphql: expected --input -", 2);

  const body = JSON.parse(await readStdin());
  const query = String(body.query ?? "");
  const variables = body.variables ?? {};
  const viewed = db.viewed ?? {};

  const prKey = String(variables.number ?? db.default ?? "");
  const pull = db.pullRequests?.[prKey];
  if (!pull) fail(`Could not resolve to a PullRequest with the number of ${prKey}.`, 1);

  const pullRequestId = db.pullRequestId ?? `PR_mock_${prKey}`;
  const files = viewed[prKey] ?? {};

  if (/FileAsViewed/.test(query)) {
    const path = String(variables.path ?? "");
    if (!path) fail("mock gh graphql: missing path", 2);
    // unmarkFileAsViewed contains markFileAsViewed as a substring, so the
    // unmark check must come first.
    const mark = !/unmarkFileAsViewed/.test(query);
    files[path] = mark ? "VIEWED" : "UNVIEWED";
    viewed[prKey] = files;
    db.viewed = viewed;
    await saveDb(db);
    process.stdout.write(JSON.stringify({
      data: { [mark ? "markFileAsViewed" : "unmarkFileAsViewed"]: { pullRequest: { id: pullRequestId } } },
    }) + "\n");
    process.exit(0);
  }

  // The reviewed-files query: every tracked path plus the real PR files.
  const nodes = Object.keys(files).map((path) => ({ path, viewerViewedState: files[path] }));
  process.stdout.write(JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          id: pullRequestId,
          files: { nodes, pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    },
  }) + "\n");
  process.exit(0);
}
if (argv[0] === "api") {

  const db = await loadDb();
  if (db.auth === false) fail("You are not logged into any GitHub hosts. Run gh auth login.", 1);

  const endpoint = positionalArg(argv, 1);
  const match = /repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/reviews$/.exec(String(endpoint ?? ""));
  if (!match) fail(`mock gh api: unsupported endpoint ${endpoint}`, 2);
  if (!argv.includes("--input")) fail("mock gh api: expected --input -", 2);


  if (!db.pullRequests?.[match[2]] && !Object.keys(db.pullRequests ?? {}).length) {
    fail(`no pull requests found for #${match[2]}`, 1);
  }

  const payload = JSON.parse(await readStdin());
  const entry = await recordReview(db, {
    repo: match[1],
    number: match[2],
    event: payload.event,
    body: payload.body ?? "",
    commit_id: payload.commit_id ?? null,
    comments: payload.comments ?? [],
  });


  process.stdout.write(JSON.stringify({
    id: entry.id,
    html_url: `https://github.com/${match[1]}/pull/${match[2]}#pullrequestreview-${entry.id}`,
    body: entry.body,
    event: entry.event,
  }) + "\n");
  process.exit(0);
}
fail(`mock gh: unsupported command: ${argv.join(" ")}`, 2);

async function recordReview(db, review) {
  const published = Array.isArray(db.publishedReviews) ? db.publishedReviews : [];
  const entry = { id: published.length + 1, ...review, at: new Date().toISOString() };
  published.push(entry);
  db.publishedReviews = published;
  await saveDb(db);
  return entry;
}

async function saveDb(db) {
  const body = JSON.stringify(db, null, 2);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(process.env.MOCK_GH_DB, body, "utf8");
}

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
