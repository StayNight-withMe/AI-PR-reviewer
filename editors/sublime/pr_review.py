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
    return None
class PrReviewState:
    """Owns the one running engine process."""
    process = None
    url = None
def _read_stdout(process):
    for raw in iter(process.stdout.readline, b""):
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        if line.startswith(READY_PREFIX):
            payload = json.loads(line[len(READY_PREFIX):])
            PrReviewState.url = payload.get("url")
            summary = "%s (+%s / -%s)" % (
                payload.get("branch") or "review",
                payload.get("additions", 0),
                payload.get("deletions", 0),
            )
            sublime.status_message("PR Review: %s" % summary)
            if _setting("open", "browser") == "browser" and PrReviewState.url:
                webbrowser.open(PrReviewState.url)
        elif line.startswith(ERROR_PREFIX):
            sublime.error_message("PR Review: %s" % line[len(ERROR_PREFIX):])
class PrReviewOpenCommand(sublime_plugin.WindowCommand):
    """Builds and opens the review of the current branch."""
    def run(self):
        if PrReviewState.process is not None:
            if PrReviewState.url:
                webbrowser.open(PrReviewState.url)
            return
        cli = _resolve_cli()
        if not cli:
            sublime.error_message(
                "PR Review: src/cli.js was not found. Set \"cli_path\" in "
                "pr-review.sublime-settings."
            )
            return
        repo = _find_repo_root(os.getcwd())
        command = [
            _setting("node_path", "node"),
            cli,
            "--repo", repo,
            "--mode", _setting("mode", "branch"),
            "--json",
        ]
        base = _setting("base", "")
        if base:
            command += ["--base", base]
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
