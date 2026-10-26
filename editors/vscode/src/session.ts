/**
 * Runs the review server and talks to it.
 *
 * One review is active at a time. The heavy lifting (scope, diff, page) lives
 * in the bundled server; this class only starts it, reads the one ready line
 * and stops it again. Keeping the process around is what keeps the page alive.
 */
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import * as readline from "readline";
/** The one line the server prints when the page is up. */
const READY_PREFIX = "PR_REVIEW_READY ";
const ERROR_PREFIX = "PR_REVIEW_ERROR ";
const START_TIMEOUT_MS = 60_000;
export interface ReviewInfo {
  url: string;
  reviewId: string;
  port: number;
  repo: string;
  branch: string;
  mode: string;
  base: string | null;
  head: string | null;
  files: number;
  additions: number;
  deletions: number;
  outputDir: string;
}
export interface LaunchOptions {
  nodePath: string;
  cliPath: string;
  cwd: string;
  mode: string;
  base?: string;
  title?: string;
  /** How long to wait for the ready line. Overridable so tests stay fast. */
  startTimeoutMs?: number;
}
