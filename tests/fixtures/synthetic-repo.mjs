
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { resolveGitBinary } from "../../src/git.js";
const exec = promisify(execFile);

const AUTHORS = [
  { name: "Анна Ковалёва", email: "anna@example.com" },
  { name: "Bob Stone", email: "bob@example.com" },
  { name: "Дмитрий 🎯", email: "dmitry@example.com" },
];
const MAIN = "main";
const FEATURE = "feature/synthetic";

const START_DATE = "2026-09-14T09:00:00+03:00";
export { MAIN, FEATURE, START_DATE };

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


  await run(["checkout", "-b", FEATURE]);
  await write("src/feature.ts", "export const feature = 'first';\n");
  await commit("feat: add the feature module", { date: "2026-09-21T11:30:00+03:00", author: AUTHORS[1] });

  await run(["checkout", MAIN]);
  await write("src/app.ts", `${await readFile(join(root, "src/app.ts"))}\nexport function version(): string {\n  return '1.0.0';\n}\n`);
  await commit("feat(app): expose the version", { date: "2026-09-28T10:15:00+03:00" });


  await write("src/generated/large.ts", largeFile(3_000));
  await commit("chore(generated): add the generated client", { date: "2026-10-05T09:45:00+03:00", author: AUTHORS[2] });


  await write("assets/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff, 0xfe]));
  await commit("feat(assets): add the logo", { date: "2026-10-12T14:05:00+03:00" });


  await write("src/long-line.ts", `export const payload = "${"x".repeat(4_000)}";\n`);
  await commit("perf: add the generated payload", { date: "2026-10-19T16:40:00+03:00", author: AUTHORS[1] });


  await run(["mv", "src/legacy.ts", "src/modern.ts"]);
  await write("src/modern.ts", "export const legacy = false;\nexport const modern = true;\n");
  await commit("refactor: rename legacy to modern", { date: "2026-10-26T12:00:00+03:00" });


  await run(["rm", "src/obsolete.ts"]);
  await commit("chore: drop the obsolete module", { date: "2026-11-02T08:20:00+03:00", author: AUTHORS[2] });


  await write("scripts/run.sh", "#!/bin/sh\necho run\n");
  await run(["add", "scripts/run.sh"]);
  await run(["update-index", "--chmod=+x", "scripts/run.sh"]);
  await commit("chore(scripts): mark the runner as executable", { date: "2026-11-09T13:30:00+03:00" });


  await run(["update-index", "--chmod=-x", "scripts/run.sh"]);
  await commit("chore(scripts): drop the executable bit", { date: "2026-11-10T09:00:00+03:00", author: AUTHORS[1] });


  for (let index = 0; index < 150; index += 1) {
    await write(`src/generated/many/module-${String(index).padStart(3, "0")}.ts`, `export const value${index} = ${index};\n`);
  }
  await commit("chore(generated): add the module family", { date: "2026-11-16T15:45:00+03:00" });


  await write("src/util.ts", "export const clamp = (value: number, min: number, max: number): number =>\n  Math.min(Math.max(value, min), max);\n\n\nexport const noop = (): void => undefined;\n");
  await commit("style: add a noop helper", { date: "2026-11-23T10:10:00+03:00", author: AUTHORS[2] });


  await write("docs/файл.md", "# Документ\n\nКириллица в имени и в содержимом.\n\nДобавлен абзац про «ёлочки» и emoji 🎯.\n");
  await commit("docs: extend the document 📝", { date: "2026-11-24T17:55:00+03:00" });


  await commit("chore: empty checkpoint", { date: "2026-11-25T12:00:00+03:00", author: AUTHORS[1], allowEmpty: true });


  await run(["checkout", FEATURE]);
  await write("src/feature.ts", "export const feature = 'second';\nexport const featureReady = true;\n");
  await commit("feat: finish the feature module", { date: "2026-11-26T09:00:00+03:00", author: AUTHORS[1] });
  await run(["checkout", MAIN]);
  await run(["merge", "--no-ff", "-m", "merge: bring the feature branch back", FEATURE]);


  await write("src/generated/large.ts", largeFile(8_000));
  await commit("chore(generated): grow the generated client", { date: "2026-12-01T11:11:00+03:00", author: AUTHORS[2] });


  const generated = await readFile(join(root, "src/generated/large.ts"));
  await write("src/generated/large.ts", generated.replace("return value + 5;", "return value + 500;"));
  await commit("fix(generated): correct the fifth function", { date: "2026-12-02T09:00:00+03:00" });


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

function largeFile(count) {
  const lines = ["// Generated file. Do not edit by hand.", ""];
  for (let index = 1; index <= count; index += 1) {
    lines.push(`export function generated${index}(value: number): number {`);
    lines.push(`  return value + ${index};`);
    lines.push("}");
    lines.push("");
  }
  return lines.join("\n");
}

async function readFile(path) {
  const { readFile: read } = await import("node:fs/promises");
  return read(path, "utf8");
}
