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
