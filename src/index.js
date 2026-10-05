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
