/**
 * A declaration quoted in a markdown file must not become the definition.
 *
 * The symbol index used to scan every tracked file, so a `public class Tag`
 * inside a fenced example in README.md won the alphabetical race against
 * src/Tag.cs: the definition link pointed into prose, and usages counted the
 * quote as code. Definitions now come from source extensions only.
 *
 * Run: node tests/symbols-prose.mjs
 */
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSymbolIndex } from "../src/symbols.js";

const ROOT = join(tmpdir(), "pr-review-symbols-prose-");

const failures = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failures.push(`${name}: ${error.message}`); console.log(`FAIL ${name} — ${error.message}`); },
  );
}

async function makeRepo(files) {
  const root = ROOT + Math.random().toString(36).slice(2, 8);
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, text);
  }
  const run = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  run(["init"]);
  run(["-c", "user.email=t@t.t", "-c", "user.name=t", "add", "-A"]);
  run(["-c", "user.email=t@t.t", "-c", "user.name=t", "commit", "-m", "x"]);
  return root;
}

await check("a fenced class in markdown does not shadow the real definition", async () => {
  const root = await makeRepo({
    "README.md": "# Notes\n\n```csharp\npublic class Tag\n{\n}\n```\n",
    "src/Tag.cs": "namespace N;\n\npublic class Tag\n{\n}\n",
  });
  const index = await buildSymbolIndex(root);
  assert.equal(index.symbols.Tag?.path, "src/Tag.cs",
    `the definition must be the source file, got ${JSON.stringify(index.symbols.Tag)}`);
});

await check("prose mentions are still counted as usages", async () => {
  const root = await makeRepo({
    "README.md": "# Notes\n\nUses `Tag` here.\n",
    "src/Tag.cs": "namespace N;\n\npublic class Tag\n{\n}\n",
    "src/User.cs": "namespace N;\npublic class User\n{\n  public Tag T { get; set; }\n}\n",
  });
  const index = await buildSymbolIndex(root);
  const readme = (index.usages.Tag ?? []).find((usage) => usage.path === "README.md");
  assert.ok(readme, "the README mention should stay in the usage list");
});

await check("definitions in source files are still indexed", async () => {
  const root = await makeRepo({
    "src/A.cs": "namespace N;\npublic class Alpha {}\n",
    "src/B.cs": "namespace N;\npublic class Beta {}\n",
  });
  const index = await buildSymbolIndex(root);
  assert.equal(index.symbols.Alpha?.path, "src/A.cs");
  assert.equal(index.symbols.Beta?.path, "src/B.cs");
});

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exitCode = 1;
} else {
  console.log("\nAll symbol-prose checks passed");
}
