
(function () {
  "use strict";

  var PR = window.PR;


  // Applies one viewed flag to the page: the state, the section, the tree row.
  // Used both by the checkbox and by a rollback when GitHub rejects the change.
  PR.setViewedLocal = function (path, on) {
    var state = PR.state;
    if (on) {
      state.viewed.add(path);
      state.lastViewedFile = path;
    } else {
      state.viewed.delete(path);
      if (state.lastViewedFile === path) state.lastViewedFile = null;
    }

    var section = PR.els.diffFiles.querySelector('section[data-path="' + PR.cssEscape(path) + '"]');
    if (section) {
      section.classList.toggle("is-viewed", on);
      var wrap = section.querySelector(".viewed-wrap");
      if (wrap) wrap.classList.toggle("checked", on);

      if (on && state.settings.collapseViewed) {
        state.collapsed.add(path);
        collapseWithAnimation(section);
      } else if (!on) {
        state.collapsed.delete(path);
        section.classList.remove(PR.SELECTORS.COLLAPSED);
      }
    } else if (on) {
      state.collapsed.add(path);
    }

    PR.updateTreeFileRow(path);
    PR.renderSummary();
    PR.renderProgress();
    PR.store();
  };


  PR.toggleViewed = function (path) {
    PR.perf("Viewed", function () {
      var on = !PR.state.viewed.has(path);
      PR.setViewedLocal(path, on);

      // GitHub is the storage: the same checkbox state then shows on
      // github.com and survives new commits pushed to the pull request.
      if (PR.pushViewedToGitHub) PR.pushViewedToGitHub(path, on);
    });
  };



  PR.commitLabel = function (commit) {
    var custom = PR.state.commitLabels[commit.sha];
    return custom || commit.subject;
  };


  PR.isCommitLocked = function (commit) {
    if (!commit.pushed) return false;
    return !PR.state.commitUnlocked[commit.sha];
  };

  PR.toggleCommitUnlock = function (sha, on) {
    if (on) PR.state.commitUnlocked[sha] = true;
    else delete PR.state.commitUnlocked[sha];
    PR.store();
    PR.renderCommits();
  };

  PR.renameCommit = function (sha, title) {
    var trimmed = String(title || "").trim();
    var commit = findCommit(sha);

    if (!trimmed) {
      PR.toast(PR.MESSAGES.COMMIT_LABEL_EMPTY, true);
      return Promise.resolve(false);
    }
    if (!commit) return Promise.resolve(false);

    if (PR.isCommitLocked(commit)) {
      PR.toast(PR.MESSAGES.COMMIT_PUSHED_LOCKED, true);
      return Promise.resolve(false);
    }

    if (!commit.isHead) {

      PR.toast(PR.MESSAGES.COMMIT_NOT_HEAD, true);
      return Promise.resolve(false);
    }

    if (trimmed === commit.subject) {

      delete PR.state.commitLabels[sha];
      PR.store();
      PR.renderCommits();
      return Promise.resolve(true);
    }

    return fetch(PR.API.COMMIT_RENAME, {
      method: PR.HTTP.POST,
      headers: { "content-type": PR.HTTP.JSON },
      body: JSON.stringify({ sha: sha, message: trimmed, allowPushed: commit.pushed === true }),
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok) throw new Error((result && result.error) || "Unknown error");

        return refreshCommits().then(function () {
          PR.toast(PR.MESSAGES.COMMIT_LABEL_SAVED);
          return true;
        });
      })
      .catch(function (error) {
        PR.toast(PR.MESSAGES.COMMIT_RENAME_FAILED + error.message, true);
        return false;
      });
  };


  function refreshCommits() {
    return fetch(PR.API.COMMITS)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok) throw new Error("Could not reload commits");

        var state = PR.state;
        state.commits = result.commits;
        state.commitLabels = {};
        state.commitUnlocked = {};
        state.commitSelection = [];
        PR.store();
        PR.renderCommits();
      });
  }

  function findCommit(sha) {
    var commits = PR.state.commits;
    for (var i = 0; i < commits.length; i += 1) if (commits[i].sha === sha) return commits[i];
    return null;
  }


  function collapseWithAnimation(section) {
    var body = section.querySelector(PR.SELECTORS.DIFF_BODY);
    if (!body || !section.isConnected) {
      section.classList.add(PR.SELECTORS.COLLAPSED);
      return;
    }

    var height = body.getBoundingClientRect().height;
    body.style.height = height + "px";
    body.style.overflow = PR.SELECTORS.HIDDEN;
    body.style.transition = "height " + PR.UI.VIEWED_ANIM_MS + "ms cubic-bezier(0.4, 0, 0.2, 1), opacity " +
      PR.UI.VIEWED_ANIM_MS + "ms ease";

    void body.offsetHeight;
    body.style.height = "0px";
    body.style.opacity = "0";

    setTimeout(function () {

      if (!section.isConnected) return;

      body.style.transition = "";
      body.style.height = "";
      body.style.overflow = "";
      body.style.opacity = "";
      section.classList.add(PR.SELECTORS.COLLAPSED);
    }, PR.UI.VIEWED_ANIM_MS);
  }


  PR.renderCommits = function () {
    var state = PR.state;
    if (!PR.els.commitList) return;

    if (!state.commits.length) {
      PR.setHtml(PR.els.commitList, '<div class="empty-state" style="padding:24px">No commits found.</div>');
      PR.syncScopeHint();
      return;
    }

    PR.setHtml(PR.els.commitList, state.commits.map(commitRow).join(""));
    PR.syncScopeHint();
  };

  function commitRow(commit) {
    var sha = commit.sha || commit.shortSha;
    var label = PR.commitLabel(commit);
    var selected = PR.state.commitSelection.indexOf(sha) >= 0;
    var locked = PR.isCommitLocked(commit);
    var unlocked = commit.pushed && !locked;

    return '<div class="commit-item' + (selected ? " is-selected" : "") +
        (commit.pushed ? " is-pushed" : "") + (unlocked ? " is-unlockable" : "") + '" data-sha="' + PR.escapeHtml(sha) + '">' +
      '<span class="commit-dot"></span>' +
      '<div class="commit-body">' +
        '<span class="commit-subject js-open-commit" role="button" tabindex="0">' + PR.escapeHtml(label) + "</span>" +
        '<span class="commit-meta">' + PR.escapeHtml(commit.shortSha) + " · " +
          PR.escapeHtml(commit.authorName || "") + (commit.date ? " · " + PR.escapeHtml(PR.formatRelative(commit.date)) : "") +
          (commit.pushed ? ' · <span class="commit-lock" title="Already pushed to the remote">pushed</span>' : "") +
        "</span>" +
      "</div>" +
      renameControls(commit, sha, locked) +
      '<span class="commit-open js-open-commit">View diff →</span>' +
    "</div>";
  }


  function renameControls(commit, sha, locked) {
    if (!commit.pushed) {
      return '<button class="commit-rename js-rename-commit" title="Rename this commit in git" data-sha="' +
        PR.escapeHtml(sha) + '">Rename</button>';
    }

    return '<label class="commit-unlock' + (locked ? "" : " checked") + '" title="Allow rewriting a pushed commit">' +
      '<input type="checkbox" class="js-unlock-commit" data-sha="' + PR.escapeHtml(sha) + '"' +
        (locked ? "" : " checked") + ">Allow rewrite</label>" +
      '<button class="commit-rename js-rename-commit' + (locked ? " is-locked" : "") + '" title="' +
        (locked ? "Tick “Allow rewrite” first" : "Rename this commit in git") + '" data-sha="' + PR.escapeHtml(sha) +
        '"' + (locked ? " disabled" : "") + ">Rename</button>";
  }


  PR.startRenameCommit = function (sha) {
    var row = PR.els.commitList.querySelector('.commit-item[data-sha="' + PR.cssEscape(sha) + '"]');
    if (!row) return;

    var subject = row.querySelector(".commit-subject");
    if (!subject || row.querySelector(".js-rename-input")) return;

    var commit = findCommit(sha);
    if (!commit) return;

    var input = document.createElement("input");
    input.className = "gh-input js-rename-input";
    input.value = PR.commitLabel(commit);
    input.setAttribute("aria-label", "Commit title");

    subject.replaceWith(input);
    input.focus();
    input.select();

    var finish = function (save) {
      if (!input.isConnected) return;
      var value = input.value;
      input.replaceWith(subject);
      if (save) PR.renameCommit(sha, value);
    };

    input.addEventListener(PR.EVENT.KEYDOWN, function (event) {
      if (event.key === "Enter") { event.preventDefault(); finish(true); }
      else if (event.key === PR.KEY.ESCAPE) { event.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  };


  PR.openCommitPicker = function () {
    PR.pickerDraft = PR.state.commitSelection.slice();
    PR.renderCommitPicker();
    PR.els.commitPicker.classList.add("show");
  };

  PR.closeCommitPicker = function () {
    PR.els.commitPicker.classList.remove("show");
  };

  PR.renderCommitPicker = function () {
    var list = document.getElementById(PR.IDS.COMMIT_PICKER_LIST);
    if (!list) return;

    var commits = PR.state.commits;
    if (!commits.length) {
      PR.setHtml(list, '<div class="empty-state" style="padding:24px">No commits found.</div>');
      PR.syncPickerCount();
      return;
    }
    PR.setHtml(list, commits.map(function (commit) {
      var sha = commit.sha;
      var checked = PR.pickerDraft.indexOf(sha) >= 0;
      return '<label class="commit-pick' + (checked ? " checked" : "") + '">' +
        '<input type="checkbox" class="commit-pick-box" data-sha="' + PR.escapeHtml(sha) + '"' + (checked ? " checked" : "") + ">" +
        '<span class="commit-pick-body">' +
          '<span class="commit-pick-title">' + PR.escapeHtml(PR.commitLabel(commit)) + "</span>" +
          '<span class="commit-pick-meta">' + PR.escapeHtml(commit.authorName || "") +
            (commit.date ? " committed " + PR.escapeHtml(PR.formatRelative(commit.date)) : "") + "</span>" +
        "</span>" +
        '<span class="commit-pick-sha">' + PR.escapeHtml(commit.shortSha) + "</span>" +
      "</label>";
    }).join(""));

    PR.syncPickerCount();
  };


  PR.togglePickedCommit = function (sha, on) {
    var commits = PR.state.commits;
    var order = commits.map(function (c) { return c.sha; });
    var index = order.indexOf(sha);
    if (index < 0) return;

    var draft = PR.pickerDraft;

    if (!on) {
      PR.pickerDraft = draft.filter(function (item) { return item !== sha; });
      PR.syncPickerSelection();
      return;
    }

    if (!draft.length) {
      PR.pickerDraft = [sha];
      PR.syncPickerSelection();
      return;
    }

    var indexes = draft.map(function (item) { return order.indexOf(item); }).filter(function (i) { return i >= 0; });
    var nearest = indexes.reduce(function (best, current) {
      return Math.abs(current - index) < Math.abs(best - index) ? current : best;
    }, indexes[0]);

    var from = Math.min(nearest, index);
    var to = Math.max(nearest, index);
    PR.pickerDraft = order.slice(from, to + 1);
    PR.syncPickerSelection();
  };


  PR.syncPickerSelection = function () {
    var draft = PR.pickerDraft || [];
    var rows = document.querySelectorAll(".commit-pick");
    for (var i = 0; i < rows.length; i += 1) {
      var box = rows[i].querySelector(".commit-pick-box");
      if (!box) continue;
      var on = draft.indexOf(box.dataset.sha) >= 0;
      box.checked = on;
      rows[i].classList.toggle("checked", on);
    }
    PR.syncPickerCount();
  };

  PR.saveCommitPicker = function () {
    PR.state.commitSelection = PR.pickerDraft.slice();
    PR.closeCommitPicker();
    PR.renderCommits();
    PR.store();
  };

  PR.syncPickerCount = function () {
    var el = document.getElementById(PR.IDS.COMMIT_PICKER_COUNT);
    if (!el) return;
    var count = PR.pickerDraft ? PR.pickerDraft.length : 0;
    el.textContent = count
      ? count + " commit" + (count === 1 ? "" : "s") + " selected"
      : "Select a start and an end commit";
  };



  PR.loadBranches = function () {
    var select = document.getElementById(PR.IDS.BRANCH_SELECT);
    if (!select) return Promise.resolve();

    return fetch(PR.API.BRANCHES)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok || !Array.isArray(result.branches)) return;

        var current = PR.DATA.branch;
        var options = result.branches.slice();
        // A pull request review can be on a branch the checkout does not have
        // (a scratch clone, a fork head); the reviewed branch must still be in
        // the list and selected, not silently replaced by the first branch.
        if (current && options.indexOf(current) === -1) options.unshift(current);
        select.innerHTML = options.map(function (branch) {
          return '<option value="' + PR.escapeHtml(branch) + '"' +
            (branch === current ? " selected" : "") + ">" + PR.escapeHtml(branch) + "</option>";
        }).join("");
        select.value = current || (options[0] || "");
        PR.syncBranchHint();
      })
      .catch(function () {
        select.innerHTML = '<option value="' + PR.escapeHtml(PR.DATA.branch || "") + '">' +
          PR.escapeHtml(PR.DATA.branch || "unknown") + "</option>";
      });
  };


  PR.syncBranchHint = function () {
    var hint = document.getElementById(PR.IDS.BRANCH_HINT);
    var select = document.getElementById(PR.IDS.BRANCH_SELECT);
    if (!hint) return;

    var branch = select ? select.value : PR.DATA.branch;
    var isCurrent = !branch || branch === PR.DATA.branch;
    hint.textContent = isCurrent ? "the branch under review" : "not under review — browsing only";
  };


  PR.changeBranch = function (branch) {
    if (!branch) return Promise.resolve();
    PR.syncBranchHint();
    PR.setHtml(PR.els.commitList, '<div class="loading-row">Loading commits…</div>');

    return fetch(PR.API.BRANCH_COMMITS + "?" + PR.QUERY_BRANCH + "=" + encodeURIComponent(branch))
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok) throw new Error((result && result.error) || "Failed");
        PR.state.commits = result.commits || [];
        PR.state.commitSelection = [];
        PR.renderCommits();


        if (result.commits && result.commits.length && result.ownCommits === false) {
          PR.toast("No commits of its own — showing the latest history of " + branch);
        }
      })
      .catch(function (error) {
        PR.setHtml(PR.els.commitList, '<div class="empty-state" style="padding:24px">Could not load ' +
          PR.escapeHtml(branch) + ": " + PR.escapeHtml(error.message) + "</div>");
      });
  };

  PR.syncScopeVisibility = function () {
    var mode = document.getElementById(PR.IDS.SCOPE_MODE);
    var isRange = mode && mode.value === PR.MODE.RANGE;
    var hint = document.getElementById(PR.IDS.SCOPE_HINT);
    if (hint) hint.textContent = isRange ? "Pick commits from the list below" : "";
  };

  PR.syncScopeHint = function () {
    var hint = document.getElementById(PR.IDS.SCOPE_HINT);
    var mode = document.getElementById(PR.IDS.SCOPE_MODE);
    if (!hint || !mode) return;

    if (mode.value !== PR.MODE.RANGE) { hint.textContent = ""; return; }

    var picked = PR.state.commitSelection;
    hint.textContent = picked.length >= 2
      ? picked.length + " commits selected for the range"
      : "Pick commits from the list below";
  };

  PR.openScope = function () {
    var modeEl = document.getElementById(PR.IDS.SCOPE_MODE);
    if (!modeEl) return;

    var mode = modeEl.value;
    if (mode === PR.MODE.RANGE) {
      var picked = PR.state.commitSelection;
      if (picked.length < 2) {
        PR.toast(PR.MESSAGES.COMMITS_NEED_TWO, true);
        PR.openCommitPicker();
        return;
      }
      openRange(oldestOf(picked), newestOf(picked));
      return;
    }

    if (mode === PR.MODE.ALL) {
      var commits = PR.state.commits;
      if (commits.length < 2) { PR.toast("Not enough commits for a range", true); return; }
      openRange(commits[commits.length - 1].sha, commits[0].sha);
      return;
    }

    PR.toast("Uncommitted changes are already open");
  };


  function oldestOf(picked) {
    var order = PR.state.commits.map(function (c) { return c.sha; });
    return picked.reduce(function (best, sha) {
      return order.indexOf(sha) > order.indexOf(best) ? sha : best;
    }, picked[0]);
  }

  function newestOf(picked) {
    var order = PR.state.commits.map(function (c) { return c.sha; });
    return picked.reduce(function (best, sha) {
      return order.indexOf(sha) < order.indexOf(best) ? sha : best;
    }, picked[0]);
  }

  function openRange(from, to) {
    PR.setHtml(PR.els.diffFiles, '<div class="loading-row">Loading range…</div>');
    PR.state.tab = PR.TAB.FILES;
    PR.syncTabs();

    fetch(PR.API.RANGE + "?from=" + encodeURIComponent(from) + "&to=" + encodeURIComponent(to))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "Failed");
        PR.showDiffView(PR.VIEW_KIND.RANGE, res.files, res.stats, "Range " + from.slice(0, 7) + "…" + to.slice(0, 7));
      })
      .catch(function (err) { PR.toast("Range load failed: " + err.message, true); });
  }

  PR.openCommit = function (sha) {
    PR.closeCommentForms();
    PR.setHtml(PR.els.diffFiles, '<div class="loading-row">Loading commit ' + PR.escapeHtml(sha.slice(0, 7)) + "…</div>");

    fetch(PR.API.COMMIT + "?sha=" + encodeURIComponent(sha))
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.error || "Failed");
        var commit = findCommit(sha);
        var label = commit ? PR.commitLabel(commit) : sha.slice(0, 7);
        PR.showDiffView(PR.VIEW_KIND.COMMIT, res.files, res.stats, "Commit " + label);
      })
      .catch(function (err) { PR.toast("Commit load failed: " + err.message, true); });
  };


  PR.showDiffView = function (kind, files, stats, label) {
    var state = PR.state;
    state.view = { kind: kind, label: label };
    state.files = files;
    state.collapsed = new Set();
    state.rendered = {};
    state.changedPaths = new Set(files.map(function (f) { return f.path; }));
    state.changedMap = {};
    files.forEach(function (f) { state.changedMap[f.path] = f.status; });

    renderViewBar(label, files, stats);
    state.tab = PR.TAB.FILES;
    PR.syncTabs();
    PR.renderFileList();
    PR.renderSummary();
    PR.renderProgress();
  };

  function renderViewBar(label, files, stats) {
    var bar = document.getElementById("diff-view-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "diff-view-bar";
      bar.className = "diff-view-bar";
      PR.els.panelFiles.insertBefore(bar, PR.els.panelFiles.firstChild);
    }
    bar.innerHTML =
      '<button class="gh-btn gh-btn-sm js-back-to-review">← Back to uncommitted review</button>' +
      '<span class="view-label">' + PR.escapeHtml(label) + "</span>" +
      '<span class="small muted">' + files.length + " files · +" + stats.additions + " / −" + stats.deletions + "</span>";
  }

  PR.backToReview = function () {
    var bar = document.getElementById("diff-view-bar");
    if (bar) bar.remove();
    window.location.reload();
  };
})();
