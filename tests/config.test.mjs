/**
 * Guards against the class of bug where a module references a constant that was
 * renamed or dropped from the config: every `SYMBOL_INDEX.X`, `GIT.X`, `P.X`
 * etc. used anywhere in src/ must actually exist.
 */
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
