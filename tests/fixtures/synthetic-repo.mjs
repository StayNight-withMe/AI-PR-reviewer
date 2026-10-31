/**
 * Builds a git repository with a synthetic two-month history.
 *
 * The fixture exists to stress the review UI with the shapes a real
 * repository contains and a hand-made diff never does: renames, deletions,
 * binary files, unicode paths and content, CRLF endings, a file without a
 * trailing newline, a very long line, a mode change, a merge commit, an
 * empty commit, a few hundred generated files and a file large enough to make
 * the folding policy matter.
 *
 * The history is deterministic: same commits, same dates, same content on
 * every run, so the expectations in the tests stay stable.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { resolveGitBinary } from "../../src/git.js";
const exec = promisify(execFile);
/** The authors and the branches of the synthetic history. */
const AUTHORS = [
  { name: "Анна Ковалёва", email: "anna@example.com" },
  { name: "Bob Stone", email: "bob@example.com" },
  { name: "Дмитрий 🎯", email: "dmitry@example.com" },
];
const MAIN = "main";
const FEATURE = "feature/synthetic";
/** The first commit of the synthetic history. */
const START_DATE = "2026-09-14T09:00:00+03:00";
