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
