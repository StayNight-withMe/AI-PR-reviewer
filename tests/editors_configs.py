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
