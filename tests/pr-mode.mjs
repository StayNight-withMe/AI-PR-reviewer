/**
 * `mode=pr` against a mock `gh` and a real local git remote.
 *
 * No network, no GitHub account, no real repository: the fixture builds a real
 * git repo with a bare "origin" that carries `refs/pull/<n>/head`, and the mock
 * `gh` answers from a JSON database. That makes every PR path deterministic and
 * lets the test assert exact file sets instead of "some files".
 *
 * Run: node tests/pr-mode.mjs
 */
