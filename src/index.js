#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listBranchHeads, listBranches, listCommits, resolveRepo } from "./git.js";
import { buildMarkdown } from "./render.js";
import { writeReviewFiles } from "./server.js";
import { startReview } from "./core.js";
import { resolveSessionId } from "./dispatch.js";
import { writeReviewOwner } from "./models/owner.js";
import {
  fetchPageResult,
  findFreePort,
  findIndexedPage,
  findPageRegistry,
  forgetIndexedPage,
  indexPage,
  spawnPageProcess,
  stopPageProcess,
  waitForPageRegistry,
} from "./page-process.js";
import { APP, GH, MODE, P, SERVER, TOOLS } from "./config.js";
import { listPullRequests } from "./github.js";
/** The instruction the MCP client shows to the model. */
const INSTRUCTIONS = [
  "pr-review opens a local review page for a repository and reads the review back.",
  "Use the tools directly: start_review, await_review, get_review, list_review_scope, close_review.",
  "To review a GitHub pull request: call list_pull_requests to see the open PRs, then",
  'start_review with mode="pr" and its number (pr=N); this reads the PR through the GitHub CLI,',
  "so gh must be installed and authenticated.",
  "Do not edit the OpenCode configuration, add wrapper scripts or change how this server is",
  "launched: the server finds git on its own and needs no environment setup. If a tool fails,",
  "report the error instead of rewriting the config.",
].join(" ");
const server = new McpServer(
  {
    name: APP.NAME,
    version: APP.VERSION,
  },
  { instructions: INSTRUCTIONS },
);
const openReviews = new Map();
server.registerTool(
  "start_review",
  {
    title: "Open a pull request review",
    description:
      "Opens a GitHub-style review page in the browser for uncommitted changes, commits on a branch, specific commits, " +
      "or a whole branch. Shows a syntax-highlighted diff with inline (multi-line) comments, pasted screenshots, " +
      "go-to-definition links and a per-file viewer. Returns the URL and a reviewId.",
    inputSchema: {
      repoPath: z.string().optional().describe("Repository path. Defaults to the current working directory."),
      mode: z
        .enum([MODE.UNCOMMITTED, MODE.BRANCH, MODE.COMMITS, MODE.RANGE, MODE.ALL, MODE.PR])
        .describe(
          "Scope: uncommitted = working tree; branch = commits vs base; commits = explicit list; " +
            "range = base..head; all = every commit on the branch; " +
            "pr = a GitHub pull request read through the GitHub CLI.",
        ),
      base: z.string().optional().describe("Base ref for branch/range/all, e.g. origin/dev."),
      head: z.string().optional().describe("Head ref for branch/range. Defaults to HEAD."),
      pr: z
        .number()
        .int()
        .optional()
        .describe("For mode=pr: the pull request number. Omit to use the PR of the current branch."),
      prRepo: z
        .string()
        .optional()
        .describe("For mode=pr: owner/repo when the PR lives in another repository than the checkout."),
      branch: z.string().optional().describe("Branch name shown in the UI (defaults to the checked-out branch)."),
      commits: z.array(z.string()).optional().describe("Commit SHAs/refs for mode=commits."),
      includeStaged: z.boolean().optional().describe("Include staged changes (uncommitted). Default true."),
      includeUntracked: z.boolean().optional().describe("Include untracked files (uncommitted). Default true."),
      title: z.string().optional().describe("Optional title in the page header."),
      port: z.number().int().min(SERVER.PORT_MIN).max(SERVER.PORT_MAX).optional().describe("Fixed port; 0 picks a free one."),
      host: z.string().optional().describe(`Bind address. Default ${SERVER.HOST}.`),
      symbols: z.boolean().optional().describe("Build the go-to-definition index. Default true."),
      sessionId: z
        .string()
        .optional()
        .describe(
          "OpenCode session that owns the review. Submit sends the fix turn to this session. " +
            "Defaults to the session the server inherited.",
        ),
    },
  },
  async (args, extra) => {
    const result = await openReviewPage(args, extra);
    openReviews.set(result.reviewId, result);

    return {
      content: [
        {
          type: "text",
          text: [
            `Review ready: ${result.url}`,
            `Review ID: ${result.reviewId}`,
            result.prUrl ? `Pull request: #${result.pr} — ${result.prUrl}` : null,
            `Files: ${result.files} (+${result.additions} / -${result.deletions})`,
            `Symbols indexed: ${result.symbols}`,
            `Artifacts directory: ${result.outputDir}`,
            "",
            "Open the URL, add comments (drag line numbers for a range, paste images with Ctrl+V), then press",
            `“Request changes” to send the review back here, or “Approve”.`,
            `Call await_review with reviewId="${result.reviewId}" to receive the review in this chat.`,
          ].filter(Boolean).join("\n"),
        },
      ],
    };
  },
);
/** Opens the review page. */
async function openReviewPage(args, extra) {
  const repoPath = resolve(args.repoPath ?? process.cwd());
  // user is in, while the environment belongs to whoever started this server.
  const sessionId = resolveSessionId(args.sessionId, extra);

  try {
    const root = await resolveRepo(repoPath);
    const running = await findPageRegistry(root);
    // A page of this repository is already open for the same scope: reuse it
    // instead of starting a second one on another port.
    if (running && sameScope(running.requested, args)) {
      // Reusing the page hands it to the caller: the owner file must move too,
      // or the next submit would still go to the session that opened it first.
      await writeReviewOwner(running.outputDir, sessionId);
      await indexPage(running);
      return { ...running, detached: true };
    }

    const port = await findFreePort();
    spawnPageProcess({
      repoPath: root,
      mode: args.mode,
      base: args.base,
      head: args.head,
      pr: args.pr,
      prRepo: args.prRepo,
      port,
      title: args.title,
      sessionId,
      commits: args.commits,
      includeStaged: args.includeStaged,
      includeUntracked: args.includeUntracked,
      symbols: args.symbols,
    });

    const registry = await waitForPageRegistry(root);
    if (registry) {
      await writeReviewOwner(registry.outputDir, sessionId);
      await indexPage(registry);
      return { ...registry, detached: true };
    }
  } catch {
  // page inside this process.
  }

  const result = await startReview({ ...args, sessionId });
  return {
    reviewId: result.reviewId,
    url: result.url,
    outputDir: result.outputDir,
    files: result.files,
    additions: result.additions,
    deletions: result.deletions,
    symbols: result.symbols,
    pr: result.meta.pr ? result.meta.pr.number : null,
    prUrl: result.meta.pr ? result.meta.pr.url : null,
    page: result.page,
    detached: false,
  };
}
