/**
 * Unit checks for the GitHub pull-request scope, without the network.
 *
 * The live PR read is covered by tests/github.mjs; this file pins the small
 * pure/plumbing pieces so a change to them fails fast.
 *
 * Run: node --test tests/github-unit.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
