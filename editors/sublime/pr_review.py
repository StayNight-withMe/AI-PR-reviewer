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
