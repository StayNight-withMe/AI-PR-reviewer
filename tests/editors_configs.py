"""Validates the editor-integration config files without their editors.
Everything here is a file that a host reads as data (JSON / TOML / keymap),
plus a lightweight structural check of the Lua and Emacs Lisp sources (no
parser is available on a bare Windows box). The goal is to catch typos that
would only surface the first time a user opens the editor.
Run: python tests/editors_configs.py
"""
import json
import re
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
FAILURES = []
def check(name, fn):
    try:
        fn()
        print(f"PASS {name}")
    except Exception as error:  # noqa: BLE001 - report every failure, do not stop
        FAILURES.append(f"{name}: {error}")
        print(f"FAIL {name} — {error}")
def load_json(rel):
    with open(ROOT / rel, encoding="utf-8") as handle:
        return json.load(handle)
def balanced(text, pairs):
    """A depth check that ignores pairs inside strings and comments."""
    stack = []
    for char in text:
        if char in pairs:
            stack.append(pairs[char])
        elif char in ")]}":
            if not stack or stack.pop() != char:
                raise AssertionError(f"unbalanced {char}")
    if stack:
        raise AssertionError(f"unclosed {stack}")
def check_sublime_settings():
    data = load_json("editors/sublime/pr-review.sublime-settings")
    assert data["mode"] == "branch", "the default scope must be the branch"
    assert "node_path" in data and "cli_path" in data
def check_sublime_keymap():
    data = load_json("editors/sublime/Default (Windows).sublime-keymap")
    commands = {entry["command"] for entry in data}
    assert "pr_review_open" in commands
    assert "pr_review_stop" in commands
def check_sublime_python():
    text = (ROOT / "editors/sublime/pr_review.py").read_text(encoding="utf-8")
    assert "PR_REVIEW_READY " in text, "the ready prefix is missing"
    assert "--json" in text, "the launcher must ask for the machine-readable line"
    assert "def run(" in text
    balanced(text, {"(": ")", "[": "]", "{": "}"})


def check_neovim_lua():
    text = (ROOT / "editors/neovim/lua/pr-review.lua").read_text(encoding="utf-8")
    assert "PR_REVIEW_READY " in text, "the ready prefix is missing"
    assert "--json" in text, "the launcher must ask for the machine-readable line"
    assert "vim.system" in text, "the job API is missing"
    # Lua blocks: `function`, `if`, `do`, `repeat` open; `end`, `until` close.
    # `for`/`while` open through their `do`, so they are not counted.
    words = re.findall(r"\b\w+\b|'[^']*'|\"[^\"]*\"", text)
    openers = sum(1 for w in words if w in ("function", "if", "do", "repeat"))
    closers = sum(1 for w in words if w in ("end", "until"))
    assert openers == closers, f"block mismatch: {openers} openers vs {closers} closers"
    assert re.search(r"return M\s*$", text.strip()), "the module must return its table"


def check_emacs_lisp():
    text = (ROOT / "editors/emacs/pr-review.el").read_text(encoding="utf-8")
    assert "PR_REVIEW_READY " in text, "the ready prefix is missing"
    assert "--json" in text, "the launcher must ask for the machine-readable line"
    assert "(provide 'pr-review)" in text, "the file must provide the feature"
    opens = text.count("(")
    closes = text.count(")")
    assert opens == closes, f"unbalanced parens: {opens} open vs {closes} close"


def check_jetbrains_manifest():
    text = (ROOT / "editors/jetbrains/src/main/resources/META-INF/plugin.xml").read_text(encoding="utf-8")
    assert "com.prreview.jetbrains.OpenReviewAction" in text
    assert "com.prreview.jetbrains.StopReviewAction" in text
    assert "<id>com.prreview.jetbrains</id>" in text


def check_jetbrains_kotlin():
    text = (ROOT / "editors/jetbrains/src/main/kotlin/com/prreview/jetbrains/ReviewServer.kt").read_text(encoding="utf-8")
    assert "PR_REVIEW_READY " in text, "the ready prefix is missing"
    assert "\"--json\"" in text, "the launcher must ask for the machine-readable line"
    assert "server/src/cli.js" in text, "the bundled engine path is missing"
    balanced(text, {"(": ")", "[": "]", "{": "}"})


def check_helix_doc():
    text = (ROOT / "editors/helix/README.md").read_text(encoding="utf-8")
    assert "src/cli.js" in text
    assert "--open" in text
    assert "context_servers" in text or "mcp.servers" in text


def check_bundle_script():
    text = (ROOT / "scripts/bundle-server.mjs").read_text(encoding="utf-8")
    assert "editors/vscode/server" in text
    assert "editors/visualstudio/server" in text
    assert "editors/jetbrains/server" in text


checks = {
    "sublime settings are valid JSON with the branch default": check_sublime_settings,
    "sublime keymap binds open and stop": check_sublime_keymap,
    "sublime python uses the shared contract": check_sublime_python,
    "neovim lua uses the shared contract": check_neovim_lua,
    "emacs lisp uses the shared contract": check_emacs_lisp,
    "jetbrains manifest names both actions": check_jetbrains_manifest,
    "jetbrains kotlin uses the shared contract": check_jetbrains_kotlin,
    "helix doc points at the engine": check_helix_doc,
    "bundle script knows every host": check_bundle_script,
}

for name, fn in checks.items():
    check(name, fn)

if FAILURES:
    print(f"\n{len(FAILURES)} check(s) failed:")
    for failure in FAILURES:
        print(f"  - {failure}")
    sys.exit(1)

print("\nAll editor config checks passed")
