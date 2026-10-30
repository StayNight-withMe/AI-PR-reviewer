#!/usr/bin/env node
/**
 * A stand-in for the GitHub CLI, for tests.
 *
 * It speaks only the two commands the review engine uses — `gh pr view` and
 * `gh auth status` — and reads its data from a JSON "database" whose path is in
 * MOCK_GH_DB. That makes `mode=pr` testable with no network, no token and no
 * real GitHub account.
 *
 * The database shape:
