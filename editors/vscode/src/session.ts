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
