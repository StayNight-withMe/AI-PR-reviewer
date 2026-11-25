
(function () {
  "use strict";

  var PR = window.PR;

  // GitHub owns the "viewed" state of a pull-request file: it is stored on the
  // GitHub side, per user, so the same files show as reviewed here as on
  // github.com, and the state survives new commits, a new port, a new browser.
  // Without a pull request there is nothing to sync with.
  var pullRequestId = null;
  var syncQueue = Promise.resolve();
  var pendingPaths = {};

  PR.syncViewedFromGitHub = function () {
    if (!PR.DATA || !PR.DATA.pr) return Promise.resolve(false);

    return fetch(PR.API.VIEWED)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok || result.available === false) return false;

        pullRequestId = result.id ?? pullRequestId;

        // GitHub is the source of truth: only VIEWED counts. DISMISSED means
        // new commits touched the file after it was viewed, and github.com
        // shows it unchecked again, so this page does the same.
        var files = result.files || {};
        var next = new Set();
        Object.keys(files).forEach(function (path) {
          if (files[path] !== "VIEWED") return;
          if (!PR.state.changedPaths.has(path)) return;
          next.add(path);
        });

        var applied = next.size - PR.state.viewed.size;
        PR.state.viewed = next;

        PR.renderFileList();
        PR.renderSummary();
        PR.renderProgress();
        PR.store();
        return applied !== 0;
      })
      .catch(function () { return false; });
  };

  // One file, one call: GitHub applies the change and returns the truth, so a
  // failure rolls the checkbox back instead of silently diverging from GitHub.
  PR.pushViewedToGitHub = function (path, viewed) {
    if (!PR.DATA || !PR.DATA.pr) return;

    pendingPaths[path] = viewed;
    syncQueue = syncQueue
      .catch(function () {})
      .then(function () {
        var next = pendingPaths[path];
        delete pendingPaths[path];
        if (next === undefined) return;

        return fetch(PR.API.VIEWED, {
          method: PR.HTTP.POST,
          headers: { "content-type": PR.HTTP.JSON },
          body: JSON.stringify({ path: path, viewed: next }),
        })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            if (result && result.ok) return;

            // The mark is only real once GitHub accepted it.
            if (PR.state.viewed.has(path) === next) PR.setViewedLocal(path, !next);
            if (PR.toast) {
              PR.toast("GitHub did not save the viewed state: " + ((result && result.error) || "unknown error"), true);
            }
          })
          .catch(function () {
            if (PR.state.viewed.has(path) === next) PR.setViewedLocal(path, !next);
            if (PR.toast) PR.toast("Could not reach GitHub to save the viewed state.", true);
          });
      });
  };
})();
