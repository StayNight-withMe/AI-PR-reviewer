"""
PR Review for Sublime Text.
One command builds a review of the current branch and opens the page in the
browser. All the work lives in the shared engine `src/cli.js`; this plugin only
starts it, reads the one PR_REVIEW_READY line and opens the URL.
Install: put this folder in Packages/ (Preferences > Browse Packages) and add
the "PR Review" key binding from Default (Windows).sublime-keymap.
"""
import json
import os
import subprocess
import threading
import webbrowser
import sublime
import sublime_plugin
READY_PREFIX = "PR_REVIEW_READY "
ERROR_PREFIX = "PR_REVIEW_ERROR "
_settings = sublime.load_settings("pr-review.sublime-settings")
def _setting(name, default):
    return _settings.get(name, default)
def _find_repo_root(start):
    """The nearest ancestor that holds a .git entry, or the start folder."""
    directory = start
    while directory:
        if os.path.isdir(os.path.join(directory, ".git")) or os.path.isfile(os.path.join(directory, ".git")):
            return directory
        parent = os.path.dirname(directory)
        if parent == directory:
            break
        directory = parent
    return start
def _resolve_cli():
    """The configured engine path, else the copy bundled next to this plugin."""
    configured = _setting("cli_path", "")
    if configured:
        return configured
    here = os.path.dirname(os.path.abspath(__file__))
    bundled = os.path.join(here, "server", "src", "cli.js")
    if os.path.isfile(bundled):
        return bundled
