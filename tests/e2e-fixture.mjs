import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { startReview } from "../src/core.js";
import { GIT, MODE } from "../src/config.js";

const exec = promisify(execFile);


export async function createE2eReview() {
  const root = await mkdtemp(join(tmpdir(), "pr-review-e2e-"));
  const git = (...args) => exec(GIT.BIN, args, { cwd: root });
  const write = async (path, content) => {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  };

  try {
    await git("init", "--initial-branch", "main");
    await git("config", "user.email", "[REDACTED_EMAIL]");
    await git("config", "user.name", "E2E Test");
    await git("config", "core.autocrlf", "false");

    await write("README.md", "# E2E fixture\n");
    await write("src/services/AtlasService/Atlas.Domain/Constants/AtlasConstants.cs",
      "namespace Atlas.Domain.Constants\n{\n    public static class AtlasConstants\n    {\n" +
      Array.from({ length: 12 }, (_, i) => `        public const string Value${i} = "value${i}";`).join("\n") +
      "\n    }\n}\n");
    await write("src/context.cs",
      "namespace Atlas\n{\n    public class ContextFile\n    {\n" +
      Array.from({ length: 100 }, (_, i) => `        public int ContextValue${i} { get; set; } = ${i};`).join("\n") +
      "\n    }\n}\n");
    await write("src/services/AtlasService/Atlas.Domain/Entities/KnowledgeArticle.cs",
      "namespace Atlas.Domain.Entities\n{\n    public interface IHasUpdatedAt\n    {\n        DateTime UpdatedAt { get; }\n    }\n\n" +
      "    public class KnowledgeArticle : IHasUpdatedAt\n    {\n" +
      Array.from({ length: 12 }, (_, i) => `        public string Topic${i} { get; set; } = "topic${i}";`).join("\n") +
      "\n        public DateTime UpdatedAt { get; set; }\n    }\n}\n");

    const mainLines = Array.from({ length: 90 }, (_, i) =>
      `    public string Value${i} { get; set; } = "value${i}";`);
    await write("src/services/AtlasService/Atlas.Application/MainService.cs",
      "namespace Atlas.Application\n{\n    public class MainService\n    {\n" + mainLines.join("\n") + "\n    }\n}\n");

    for (let i = 0; i < 58; i += 1) {
      await write(`src/generated/Generated${i}.cs`,
        `namespace Atlas.Generated\n{\n    public class Generated${i}\n    {\n        public string Name => "Generated${i}";\n    }\n}\n`);
    }
    await git("add", "-A");
    await git("commit", "-m", "fixture base");

    const mainHead = await git("show", "HEAD:src/services/AtlasService/Atlas.Application/MainService.cs");
    await write("src/services/AtlasService/Atlas.Application/MainService.cs",
      mainHead.stdout.replace("Value40", "Value40Updated").replace("Value80", "Value80Updated"));
    const contextHead = await git("show", "HEAD:src/context.cs");
    await write("src/context.cs", contextHead.stdout.replace("ContextValue80", "ContextValue80Updated"));
    await git("add", "-A");
    await git("commit", "-m", "change main service");

    await write("src/services/AtlasService/Atlas.Domain/Constants/AtlasConstants.cs",
      "namespace Atlas.Domain.Constants\n{\n    public static class AtlasConstants\n    {\n" +
      Array.from({ length: 12 }, (_, i) => `        public const string Value${i} = "value${i}Updated";`).join("\n") +
      "\n    }\n}\n");
    await git("add", "-A");
    await git("commit", "-m", "change constants");

    await write("src/changed-lines.cs",
      "namespace Atlas\n{\n    public class ChangedLines\n    {\n" +
      Array.from({ length: 24 }, (_, i) => `        public int Value${i} { get; set; } = ${i};`).join("\n") +
      "\n    }\n}\n");
    await git("add", "-A");
    await git("commit", "-m", "add second change");

    await write("src/changed-lines.cs",
      "namespace Atlas\n{\n    public class ChangedLines\n    {\n" +
      Array.from({ length: 24 }, (_, i) => `        public int Value${i} { get; set; } = ${i + 100};`).join("\n") +
      "\n    }\n}\n");
    await git("add", "-A");
    await git("commit", "-m", "change many lines");

    const base = (await git("rev-parse", "HEAD~4")).stdout.trim();
    process.env[GIT.ARTIFACTS_DIR_ENV] = join(root, "artifacts");
    const review = await startReview({
      repoPath: root,
      mode: MODE.RANGE,
      base,
      head: "HEAD",
      port: 0,
    });

    return {
      root,
      url: review.url,
      cleanup: async () => {
        await review.page?.close?.().catch(() => {});
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}
