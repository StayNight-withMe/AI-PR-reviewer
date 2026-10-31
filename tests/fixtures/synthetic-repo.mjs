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
export { MAIN, FEATURE, START_DATE };
/**
 * Creates the repository and returns its root.
 *
 * @param {object} [options]
 * @param {boolean} [options.keep] keep the directory instead of removing it
 * @returns {Promise<{root: string, cleanup: () => Promise<void>}>}
 */
export async function createSyntheticRepo(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "pr-review-synthetic-"));
  const git = resolveGitBinary(process.env) ?? "git";

  const run = async (args, extra = {}) => {
    const { stdout } = await exec(git, args, {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...extra },
    });
    return stdout;
  };

  const write = async (relative, content) => {
    const target = join(root, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  const commit = async (message, { date, author = AUTHORS[0], allowEmpty = false } = {}) => {
    const env = {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    };

    await run(["add", "-A"], env);

    const args = ["commit", "--no-verify", "-m", message];
    if (allowEmpty) args.push("--allow-empty");
    await run(args, env);
  };

  await run(["init", "--initial-branch", MAIN]);
  await run(["config", "user.name", "Synthetic Fixture"]);
  await run(["config", "user.email", "fixture@example.com"]);
  await run(["config", "commit.gpgsign", "false"]);
  await run(["config", "core.autocrlf", "false"]);

  /* 1. The initial state of the project. */
  await write("README.md", "# Synthetic project\n\nA repository used to test the review UI.\n");
  await write(
    "src/app.ts",
    [
      "export interface Options {",
      "  readonly retries: number;",
      "  readonly timeoutMs: number;",
      "}",
      "",
      "export function defaults(): Options {",
      "  return { retries: 3, timeoutMs: 5_000 };",
      "}",
      "",
      "export function describe(options: Options): string {",
      "  return `retries=${options.retries} timeout=${options.timeoutMs}`;",
      "}",
      "",
    ].join("\n"),
  );
  await write("src/util.ts", "export const clamp = (value: number, min: number, max: number): number =>\n  Math.min(Math.max(value, min), max);\n");
  await write("data/empty.txt", "");
  await write("data/crlf.txt", "first line\r\nsecond line\r\nthird line\r\n");
  await write("data/no-trailing-newline.txt", "the last line has no newline");
  await write("data/with space.txt", "name holds a space\n");
  await write("docs/файл.md", "# Документ\n\nКириллица в имени и в содержимом.\n");
  await write("src/legacy.ts", "export const legacy = true;\n");
  await write("src/obsolete.ts", "export const obsolete = true;\n");
  await commit("chore: initial project layout", { date: START_DATE });

  /* 2. A branch with a feature, to be merged later. */
  await run(["checkout", "-b", FEATURE]);
  await write("src/feature.ts", "export const feature = 'first';\n");
  await commit("feat: add the feature module", { date: "2026-09-21T11:30:00+03:00", author: AUTHORS[1] });

  await run(["checkout", MAIN]);
  await write("src/app.ts", `${await readFile(join(root, "src/app.ts"))}\nexport function version(): string {\n  return '1.0.0';\n}\n`);
  await commit("feat(app): expose the version", { date: "2026-09-28T10:15:00+03:00" });

  /* 3. A generated file large enough for the folding policy. */
  await write("src/generated/large.ts", largeFile(3_000));
  await commit("chore(generated): add the generated client", { date: "2026-10-05T09:45:00+03:00", author: AUTHORS[2] });

  /* 4. A binary file: the diff must not try to read it as text. */
  await write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff, 0xfe]));
  await commit("feat(assets): add the logo", { date: "2026-10-12T14:05:00+03:00" });

  /* 5. A single very long line. */
  await write("src/long-line.ts", `export const payload = "${"x".repeat(4_000)}";\n`);
  await commit("perf: add the generated payload", { date: "2026-10-19T16:40:00+03:00", author: AUTHORS[1] });

  /* 6. A rename with a change inside. */
  await run(["mv", "src/legacy.ts", "src/modern.ts"]);
  await write("src/modern.ts", "export const legacy = false;\nexport const modern = true;\n");
  await commit("refactor: rename legacy to modern", { date: "2026-10-26T12:00:00+03:00" });

  /* 7. A deletion. */
  await run(["rm", "src/obsolete.ts"]);
  await commit("chore: drop the obsolete module", { date: "2026-11-02T08:20:00+03:00", author: AUTHORS[2] });

  /* 8. A mode change. */
  await write("scripts/run.sh", "#!/bin/sh\necho run\n");
  await run(["add", "scripts/run.sh"]);
  await run(["update-index", "--chmod=+x", "scripts/run.sh"]);
  await commit("chore(scripts): mark the runner as executable", { date: "2026-11-09T13:30:00+03:00" });

  /* 9. A change of the file mode alone. */
  await run(["update-index", "--chmod=-x", "scripts/run.sh"]);
  await commit("chore(scripts): drop the executable bit", { date: "2026-11-10T09:00:00+03:00", author: AUTHORS[1] });

  /* 10. A few hundred generated files: the tree must stay usable. */
  for (let index = 0; index < 150; index += 1) {
    await write(`src/generated/many/module-${String(index).padStart(3, "0")}.ts`, `export const value${index} = ${index};\n`);
  }
  await commit("chore(generated): add the module family", { date: "2026-11-16T15:45:00+03:00" });

  /* 11. A change that only touches the whitespace. */
  await write("src/util.ts", "export const clamp = (value: number, min: number, max: number): number =>\n  Math.min(Math.max(value, min), max);\n\n\nexport const noop = (): void => undefined;\n");
  await commit("style: add a noop helper", { date: "2026-11-23T10:10:00+03:00", author: AUTHORS[2] });

  /* 12. Unicode content and an emoji in the commit message. */
  await write("docs/файл.md", "# Документ\n\nКириллица в имени и в содержимом.\n\nДобавлен абзац про «ёлочки» и emoji 🎯.\n");
  await commit("docs: extend the document 📝", { date: "2026-11-24T17:55:00+03:00" });

  /* 13. An empty commit: the diff is empty but the commit exists. */
  await commit("chore: empty checkpoint", { date: "2026-11-25T12:00:00+03:00", author: AUTHORS[1], allowEmpty: true });

  /* 14. The feature branch comes back and gets merged. */
  await run(["checkout", FEATURE]);
  await write("src/feature.ts", "export const feature = 'second';\nexport const featureReady = true;\n");
  await commit("feat: finish the feature module", { date: "2026-11-26T09:00:00+03:00", author: AUTHORS[1] });
  await run(["checkout", MAIN]);
  await run(["merge", "--no-ff", "-m", "merge: bring the feature branch back", FEATURE]);

  /* 15. The generated client grows further. */
  await write("src/generated/large.ts", largeFile(8_000));
  await commit("chore(generated): grow the generated client", { date: "2026-12-01T11:11:00+03:00", author: AUTHORS[2] });

  /* 15b. A change in the middle of the big file: the tail behind it is a
     large hidden region, which is what the folding policy is about. */
  const generated = await readFile(join(root, "src/generated/large.ts"));
  await write("src/generated/large.ts", generated.replace("return value + 5;", "return value + 500;"));
  await commit("fix(generated): correct the fifth function", { date: "2026-12-02T09:00:00+03:00" });

  /* 16. The last branch under review: a range of ordinary work. */
  await run(["checkout", "-b", "feature/review"]);
  await write("src/app.ts", `${await readFile(join(root, "src/app.ts"))}\nexport function version(): string {\n  return '2.0.0';\n}\n`);
  await write("src/new-module.ts", "export const created = true;\n");
  await run(["rm", "src/feature.ts"]);
  await commit("feat(app): ship the second version", { date: "2026-12-07T14:20:00+03:00" });
  await write("docs/новый.md", "# Новый документ\n\nЕщё один файл.\n");
  await commit("docs: add a new document", { date: "2026-12-08T10:00:00+03:00", author: AUTHORS[1] });

  return {
    root,
    git,
    async cleanup() {
      if (!options.keep) await rm(root, { recursive: true, force: true });
    },
  };
}
