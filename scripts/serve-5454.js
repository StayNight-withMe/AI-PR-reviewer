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
