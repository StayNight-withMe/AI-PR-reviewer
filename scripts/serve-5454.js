/** Standalone review server: keeps the review page alive without the MCP layer. */
import { startReview } from "../src/core.js";
import { writePageRegistry } from "../src/page-process.js";
import { MODE, SERVER } from "../src/config.js";
const DEFAULT_REPO = process.env.PR_REVIEW_REPO ?? process.cwd();
const DEFAULT_PORT = Number(process.env.PR_REVIEW_PORT ?? SERVER.DEFAULT_PORT);
const repoPath = process.argv[2] ?? DEFAULT_REPO;
const port = Number(process.argv[3] ?? DEFAULT_PORT);
// Extra args make it usable when the working tree is clean (all committed):
//   node scripts/serve-5454.js <repo> 5454 range <base> <head>
//   node scripts/serve-5454.js <repo> 5454 pr <number>
const mode = process.argv[4] ?? MODE.UNCOMMITTED;
const base = process.argv[5];
const head = process.argv[6];
// For mode=pr the PR number comes from the environment (the CLI/MCP pass it
// there), because the positional slots already carry base and head.
const prNumber = process.env.PR_REVIEW_PR || undefined;
const result = await startReview({
  repoPath,
  mode,
  base,
  head,
  pr: prNumber,
  prRepo: process.env.PR_REVIEW_PR_REPO || undefined,
  commits: parseList(process.env.PR_REVIEW_COMMITS),
  includeStaged: parseFlag(process.env.PR_REVIEW_INCLUDE_STAGED),
  includeUntracked: parseFlag(process.env.PR_REVIEW_INCLUDE_UNTRACKED),
  symbols: parseFlag(process.env.PR_REVIEW_SYMBOLS),
  host: SERVER.HOST,
  port,
  title: process.env.PR_REVIEW_TITLE || undefined,
});
