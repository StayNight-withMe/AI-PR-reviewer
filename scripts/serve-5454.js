/** Standalone review server: keeps the review page alive without the MCP layer. */
import { startReview } from "../src/core.js";
import { writePageRegistry } from "../src/page-process.js";
import { MODE, P, SERVER } from "../src/config.js";
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
  // Only an explicit PR_REVIEW_SESSION marks this page as belonging to a chat.
  // Inheriting OPENCODE_SESSION_ID from whoever launched the process gave the
  // review to that unrelated session: a review opened by hand, or by a test,
  // was delivered into another conversation's chat.
  sessionId: process.env.PR_REVIEW_SESSION || P.EMPTY,
});
console.log(`REVIEW_PAGE_URL=${result.url}`);
console.log(`REVIEW_ID=${result.reviewId}`);
console.log(`OUTPUT_DIR=${result.outputDir}`);
console.log(`FILES=${result.files} ADD=${result.additions} DEL=${result.deletions} SYMBOLS=${result.symbols}`);
console.log(`ARTIFACT_DIR=${result.outputDir}`);
// The registry lets a restarted MCP server find this page again.
await writePageRegistry(result.outputDir, {
  reviewId: result.reviewId,
  url: result.url,
  port: result.page.port,
  pid: process.pid,
  repo: result.repoRoot,
  branch: result.meta.branch,
  base: result.meta.base,
  head: result.meta.head,
  mode: result.meta.mode,
  pr: result.meta.pr ? result.meta.pr.number : null,
  prUrl: result.meta.pr ? result.meta.pr.url : null,
  requested: { mode, base: base ?? null, head: head ?? null, pr: prNumber ? Number(prNumber) : null },
  outputDir: result.outputDir,
  files: result.files,
  additions: result.additions,
  deletions: result.deletions,
  symbols: result.symbols,
  startedAt: new Date().toISOString(),
});
// Keep the process alive; review.json is written by POST /api/review.
setInterval(() => {}, SERVER.KEEPALIVE_MS);
process.on("SIGTERM", async () => {
  await result.page.close();
  process.exit(0);
});
/** A list from the environment; empty when it was not set. */
function parseList(value) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
/** A flag from the environment; undefined when it was not set. */
function parseFlag(value) {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}
