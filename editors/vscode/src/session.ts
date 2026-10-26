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
/** Owns the server process of the currently open review. */
export class ReviewSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private info: ReviewInfo | null = null;

  /** The active review, or null when nothing is open. */
  get current(): ReviewInfo | null {
    return this.info;
  }

  /** True when a review page is running. */
  get isOpen(): boolean {
    return this.child !== null && this.info !== null;
  }

  /**
   * Starts the server and resolves once the page answers.
   *
   * A previous review is stopped first: two live pages would fight over the
   * same repository artifacts and confuse the reviewer.
   */
  async start(options: LaunchOptions): Promise<ReviewInfo> {
    await this.stop();

    const args = [
      options.cliPath,
      "--repo",
      options.cwd,
      "--mode",
      options.mode,
      "--json",
    ];
    if (options.base) args.push("--base", options.base);
    if (options.title) args.push("--title", options.title);

    const child = spawn(options.nodePath, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, PR_REVIEW_OPEN: "0" },
    });

    this.child = child;
    try {
      const info = await this.waitForReady(child, options.startTimeoutMs);
      this.info = info;
      return info;
    } catch (error) {
      // A launch that failed must not leave a half-started server behind: it
      // would hold the port and the repository's artifact directory.
      await this.stop();
      throw error;
    }
  }

  /** Stops the server process; the page is closed with it. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    this.info = null;
    if (!child) return;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      child.once("exit", done);
      // A polite signal lets the server close the page; a stuck process is killed.
      child.kill();
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* already gone */ }
        done();
      }, 3_000);
    });
  }

  /** Reads stdout until the ready line arrives, or fails. */
  private waitForReady(child: ChildProcessWithoutNullStreams, timeoutMs?: number): Promise<ReviewInfo> {
    return new Promise<ReviewInfo>((resolve, reject) => {
      const reader = readline.createInterface({ input: child.stdout });
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        settle(() => reject(new Error("The review server did not start in time.")));
      }, timeoutMs ?? START_TIMEOUT_MS);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reader.close();
        fn();
      };

      reader.on("line", (line: string) => {
        if (line.startsWith(READY_PREFIX)) {
          settle(() => resolve(JSON.parse(line.slice(READY_PREFIX.length)) as ReviewInfo));
        } else if (line.startsWith(ERROR_PREFIX)) {
          settle(() => reject(new Error(line.slice(ERROR_PREFIX.length))));
        }
      });

      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", (error) => settle(() => reject(error)));
      child.on("exit", (code) => {
        settle(() => reject(new Error(stderr.trim() || `The review server exited with code ${code}.`)));
      });
    });
  }
}
