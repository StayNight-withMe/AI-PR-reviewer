
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { resolveGitBinary } from "../../src/git.js";
const exec = promisify(execFile);

export const PR_NUMBER = 7;

export const FORK_PR_NUMBER = 8;

export const REMOTE_PR_NUMBER = 9;

export const FORK_ONLY_PR_NUMBER = 10;
const AUTHOR = { name: "Test Author", email: "author@example.com" };
const START = "2026-01-05T10:00:00+00:00";

export async function createPrFixture() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-pr-"));
  const repo = join(root, "repo");
  const origin = join(root, "origin");
  const binary = resolveGitBinary(process.env) ?? "git";

  const run = async (args, cwd = repo) => {
    const { stdout } = await exec(binary, args, {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: AUTHOR.name,
        GIT_AUTHOR_EMAIL: AUTHOR.email,
        GIT_COMMITTER_NAME: AUTHOR.name,
        GIT_COMMITTER_EMAIL: AUTHOR.email,
        GIT_AUTHOR_DATE: START,
        GIT_COMMITTER_DATE: START,
      },
    });
    return stdout.trim();
  };

  const write = async (relative, content) => {
    const target = join(repo, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  const commit = async (message) => {
    await run(["add", "-A"]);
    await run(["commit", "--no-verify", "-m", message]);
    return run(["rev-parse", "HEAD"]);
  };

  await run(["init", "--bare", "--initial-branch=main", origin], root);
  await run(["init", "--initial-branch=main", repo], root);
  await run(["config", "user.name", AUTHOR.name]);
  await run(["config", "user.email", AUTHOR.email]);
  await run(["config", "commit.gpgsign", "false"]);
  await run(["config", "core.autocrlf", "false"]);
  await run(["remote", "add", "origin", origin]);


  await write("README.md", "# Fixture\n");
  await write("src/app.ts", "export const version = '1.0.0';\n");
  await write("src/removed.ts", "export const removed = true;\n");
  await write("data/with space.txt", "space\n");
  const a = await commit("chore: initial layout");

  await write("src/app.ts", "export const version = '1.1.0';\n");
  const b = await commit("feat: bump the version");


  const filler = [];
  for (let index = 1; index <= 200; index += 1) {
    filler.push(`export function fn${index}(value: number): number {`);
    filler.push(`  return value + ${index};`);
    filler.push("}");
    filler.push("");
  }
  await write("src/big.ts", filler.join("\n"));
  const bigCommit = await commit("feat: add the generated module");

  await run(["push", "origin", "main"]);
  await run(["update-ref", "refs/pull/7/base", bigCommit]);


  await run(["checkout", "-b", "feature/login"]);
  await write("src/login.ts", "export function login(): boolean {\n  return true;\n}\n");
  const f1 = await commit("feat(login): add the login module");

  await write("data/with space.txt", "space\nand more\n");
  await write("src/app.ts", "export const version = '1.1.0';\nexport const ready = true;\n");
  await write("docs/new doc.md", "# New document\n");
  await run(["rm", "src/removed.ts"]);


  await write("src/big.ts", filler.join("\n").replace("return value + 100;", "return value + 1000;"));
  const f2 = await commit("feat(app): expose readiness\n\nAlso drops the removed module.");
  await run(["push", "origin", "feature/login"]);

  await run(["update-ref", "refs/pull/7/head", f2]);
  await run(["push", "origin", "refs/pull/7/head:refs/pull/7/head"]);
  await run(["push", "origin", `refs/pull/7/base:refs/pull/7/base`]);


  await run(["checkout", "main"]);
  await run(["checkout", "-b", "feature/other"]);
  await write("src/other.ts", "export const other = 1;\n");
  const g1 = await commit("feat(other): add the other module");
  await run(["push", "origin", "feature/other"]);
  await run(["update-ref", "refs/pull/8/head", g1]);
  await run(["update-ref", "refs/pull/8/base", bigCommit]);
  await run(["push", "origin", "refs/pull/8/head:refs/pull/8/head", "refs/pull/8/base:refs/pull/8/base"]);



  await run(["checkout", "--orphan", "feature/remote-only"]);
  await writeFile(join(repo, "remote-only.txt"), "only on the remote\n");
  await run(["add", "-A"]);
  await run(["commit", "--no-verify", "-m", "feat: remote-only work"]);
  const h1 = await run(["rev-parse", "HEAD"]);
  await run(["push", "origin", "HEAD:refs/heads/feature/remote-only"]);
  await run(["update-ref", "refs/pull/9/head", h1]);
  await run(["update-ref", "refs/pull/9/base", bigCommit]);
  await run(["push", "origin", "refs/pull/9/head:refs/pull/9/head", "refs/pull/9/base:refs/pull/9/base"]);


  await run(["checkout", "main"]);
  await run(["branch", "-D", "feature/remote-only"]);




  await run(["checkout", "-b", "fork-only"]);
  await write("fork-only.txt", "from a fork\n");
  const k1 = await commit("feat: fork-only work");
  await run(["push", "origin", "HEAD:refs/pull/10/head"]);
  await run(["update-ref", "refs/pull/10/base", bigCommit]);
  await run(["push", "origin", `refs/pull/10/base:refs/pull/10/base`]);
  await run(["checkout", "main"]);
  await run(["branch", "-D", "fork-only"]);


  await run(["checkout", "main"]);
  await run(["fetch", "origin"]);

  return {
    root,
    repo,
    origin,
    binary,
    git: run,
    commits: { a, b, bigCommit, f1, f2, g1, h1, k1 },
    async cleanup() {
      await rm(root, { recursive: true, force: true }).catch(() => {});
    },
  };
}

export function pullRequestPayload(fixture, number = PR_NUMBER) {
  const table = {
    [PR_NUMBER]: { head: fixture.commits.f2, branch: "feature/login", title: "Add the login module" },
    [FORK_PR_NUMBER]: { head: fixture.commits.g1, branch: "feature/other", title: "Add the other module" },
    [REMOTE_PR_NUMBER]: { head: fixture.commits.h1, branch: "feature/remote-only", title: "Remote-only work" },
    [FORK_ONLY_PR_NUMBER]: { head: fixture.commits.k1, branch: "fork-only", title: "Fork-only work" },
  };
  const entry = table[number] ?? table[PR_NUMBER];
  return {
    number,
    title: entry.title,
    url: `https://github.com/acme/fixture/pull/${number}`,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: entry.branch,
    baseRefOid: fixture.commits.bigCommit,
    headRefOid: entry.head,
    author: { login: "octocat" },
    body: "Please review.",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
  };
}
