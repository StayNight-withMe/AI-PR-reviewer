/** Shared state, DOM refs and tiny helpers. */
(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("pr-review-data").textContent);

  var PR = window.PR;
  PR.DATA = DATA;
  // A symbol named `constructor`, `toString` or `valueOf` is a real C# name, and a
  // plain object answers those lookups with Object.prototype members. Every
  // lookup site expects an array or an entry, so the prototype made
  // `usages.reduce` throw inside hydration: the section stayed unhighlighted
  // (plain white code) and never finished loading. Null-prototype maps have no
  // inherited names at all.
  PR.SYMBOLS = symbolMap(DATA.symbols);
  PR.DEFINITIONS = symbolMap(DATA.definitions);
  PR.USAGES = symbolMap(DATA.usages);
  PR.IMPLS = symbolMap(DATA.implementations);
  PR.STORAGE_KEY = PR.UI.STORAGE_PREFIX + DATA.id;
  PR.SETTINGS_KEY = PR.UI.SETTINGS_KEY;

  PR.state = {
    files: DATA.files,
    allFiles: DATA.allFiles || [],
    commits: DATA.commits || [],
    comments: (DATA.comments || []).slice(),
    viewed: new Set(),
    collapsed: new Set(DATA.collapsed || []),
    loaded: new Set(),
    filter: "",
    treeFilter: "",
    diffMode: DATA.diffMode || PR.DIFF_MODE.UNIFIED,
    tab: PR.TAB.FILES,
    drag: null,
    selection: null,
    suppressPlusUntil: 0,
    activePinnedUntil: 0,
    spySuppressed: false,
    lastViewedFile: null,
    currentPath: PR.P_EMPTY,
    commitLabels: {},
    commitUnlocked: {},
    commitSelection: [],
    view: { kind: PR.VIEW_KIND.REVIEW },
    rendered: {},
    cache: {},
    highlightCache: {},
    nextId: 1,
    changedPaths: new Set(DATA.files.map(function (f) { return f.path; })),
    changedMap: {},
    commentMap: {},
    settings: {
      treeOpen: "current",
      hideViewed: false,
      collapseViewed: true,
      symbolLinks: "on",
      showSidebar: true,
      treeWidth: 320,
      treeHidden: false,
      treeIndent: 16,
      autoScrollTree: true,
      largeFileLines: 400,
      openLinksInline: true,
      /** Hide a region of unchanged lines only above this many non-empty lines. */
      contextCollapseLines: PR.CONTEXT.DEFAULT_COLLAPSE_LINES,
      /** Where the "View file" button opens the file. */
      viewFileMode: PR.VIEW_FILE_MODE.TAB,
      theme: PR.THEME.DARK,
    },
    /** Regions of unchanged lines the user already expanded. */
    expandedGaps: new Set(),
  };

  PR.state.files.forEach(function (f) { PR.state.changedMap[f.path] = f.status; });
  PR.state.comments.forEach(function (c) {
    var n = parseInt(String(c.id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= PR.state.nextId) PR.state.nextId = n + 1;
  });

  /** A lookup map that never answers with an inherited name. */
  function symbolMap(source) {
    var map = Object.create(null);
    if (!source) return map;
    Object.keys(source).forEach(function (key) { map[key] = source[key]; });
    return map;
  }

  PR.els = {
    headerSummary: document.getElementById("header-summary"),
    tabs: document.querySelectorAll(".gh-tab"),
    panelFiles: document.getElementById("files-tab"),
    panelCommits: document.getElementById("commits-tab"),
    tree: document.getElementById("file-tree"),
    diffFiles: document.getElementById("diff-files"),
    commitList: document.getElementById("commits-list"),
    progressFill: document.getElementById("progress-fill"),
    progress2: document.getElementById("viewed-progress-2"),
    commentCount: document.getElementById("comment-count"),
    commentList: document.getElementById("comment-list"),
    reviewStateText: document.getElementById("review-state-text"),
    reviewStateDot: document.getElementById("review-state"),
    actionStatus: document.getElementById("action-status-bar"),
    toast: document.getElementById("toast"),
    dispatchModal: document.getElementById("dispatch-modal"),
    lightbox: document.getElementById("lightbox"),
    settingsPop: document.getElementById("settings-pop"),
    commitPicker: document.getElementById("commit-picker"),
    main: document.getElementById("main-panel"),
  };

  /** ------------------------------ primitives ------------------------------ */
  PR.escapeHtml = function (value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  PR.setText = function (el, text) { if (el) el.textContent = text; };
  PR.setHtml = function (el, html) { if (el) el.innerHTML = html; };
  PR.cssEscape = function (value) { return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); };

  /** "3 hours ago" style label for an ISO timestamp, matching GitHub's picker. */
  PR.formatRelative = function (iso) {
    var then = Date.parse(iso);
    if (isNaN(then)) return iso || PR.P_EMPTY;

    var diff = Math.max(0, Date.now() - then);
    var days = Math.floor(diff / PR.PICKER.DAY_MS);
    if (days >= 1) return days + (days === 1 ? " day ago" : " days ago");

    var hours = Math.floor(diff / PR.PICKER.HOUR_MS);
    if (hours >= 1) return hours + (hours === 1 ? " hour ago" : PR.PICKER.RELATIVE_HOURS);

    var minutes = Math.floor(diff / PR.PICKER.MINUTE_MS);
    if (minutes >= 1) return minutes + (minutes === 1 ? " minute ago" : PR.PICKER.RELATIVE_MINUTES);

    return PR.PICKER.RELATIVE_NOW;
  };
  PR.anchorId = function (path) { return "file-" + path.replace(/[^a-zA-Z0-9]/g, "-"); };
  PR.fileUrl = function (path, line) { return "/file?path=" + encodeURIComponent(path) + (line ? "#L" + line : ""); };

  /** Escaped path whose line breaks only fall on `/`, never inside a file name. */
  PR.pathHtml = function (path) {
    return PR.escapeHtml(path).replace(/\//g, "/<wbr>");
  };
  PR.findFile = function (path) {
    var files = PR.state.files;
    for (var i = 0; i < files.length; i += 1) if (files[i].path === path) return files[i];
    return null;
  };

  /** The rendered section of a file, wherever it is. */
  PR.findSection = function (path) {
    var selector = 'section[data-path="' + PR.cssEscape(path) + '"]';
    if (PR.els.diffFiles) {
      var inDiff = PR.els.diffFiles.querySelector(selector);
      if (inDiff) return inDiff;
    }
    var inlineHost = document.getElementById(PR.IDS.INLINE_HOST);
    if (inlineHost) {
      var inInline = inlineHost.querySelector(selector);
      if (inInline) return inInline;
    }
    return document.querySelector(selector);
  };

  PR.toast = function (msg, isError) {
    var el = PR.els.toast;
    if (!el) return;
    el.textContent = msg;
    el.className = "toast show" + (isError ? " error" : "");
    clearTimeout(PR.toast._t);
    PR.toast._t = setTimeout(function () { el.className = "toast" + (isError ? " error" : ""); }, PR.UI.TOAST_MS);
  };

  PR.perf = function (label, fn) {
    var t0 = performance.now();
    fn();
    var ms = performance.now() - t0;
    PR.setText(PR.els.actionStatus, label + " · " + (ms < 1 ? "<1" : ms.toFixed(1)) + " ms");
    return ms;
  };

  /** ----------------------------- comment index ---------------------------- */
  PR.rebuildCommentMap = function () {
    var map = {};
    PR.state.comments.forEach(function (c) { map[c.path] = (map[c.path] || 0) + 1; });
    PR.state.commentMap = map;
  };
  PR.rebuildCommentMap();

  /** Merges comments written by the standalone viewer tab into the main review. */
  PR.syncViewerComments = function () {
    var stored = readStored();
    if (!stored.comments) return false;

    var incoming = Array.isArray(stored.comments) ? stored.comments : [];
    var merged = mergeComments(PR.state.comments, incoming);
    if (merged.length === PR.state.comments.length) return false;

    PR.state.comments = merged;
    PR.rebuildCommentMap();
    return true;
  };

  /** One comment per (path, side, lineStart, lineEnd) identity, newest wins. */
  function mergeComments(current, incoming) {
    var byKey = new Map();

    for (var i = 0; i < current.length; i += 1) {
      byKey.set(commentKey(current[i]), current[i]);
    }
    for (var j = 0; j < incoming.length; j += 1) {
      var comment = incoming[j];
      var key = commentKey(comment);
      // A viewer-side edit of the same range replaces the local copy.
      if (!byKey.has(key) || comment.id !== byKey.get(key).id) byKey.set(key, comment);
    }

    return Array.from(byKey.values());
  }

  function commentKey(comment) {
    return [comment.path, comment.side || "", comment.lineStart, comment.lineEnd || comment.lineStart].join("|");
  }

  /** ------------------------------ persistence ----------------------------- */
  /** Writes the persisted state. */
  PR.store = function () {
    var s = PR.state;
    try {
      // Another tab (the standalone viewer) may hold comments for files this tab never opened.
      var saved = readStored();
      var comments = mergeComments(s.comments, Array.isArray(saved.comments) ? saved.comments : []);

      localStorage.setItem(PR.STORAGE_KEY, JSON.stringify({
        comments: comments,
        viewed: Array.from(s.viewed),
        collapsed: Array.from(s.collapsed),
        diffMode: s.diffMode,
        tab: s.tab,
        lastViewedFile: s.lastViewedFile,
        commitLabels: s.commitLabels,
        commitUnlocked: s.commitUnlocked,
        commitSelection: s.commitSelection,
      }));
      // Settings are per device, not per review: a new review (or a changed diff, which gets a new id)…
      PR.storeSettings();
      // Comments go to the server too: the page's own storage dies with the
      // review id, and a reopened review must still show what was written.
      PR.saveThreads();
    } catch (e) {}
  };

  /** Saves comments to the server, one request at a time, so they survive a new review. */
  var threadsSave = Promise.resolve();
  PR.saveThreads = function () {
    threadsSave = threadsSave
      .catch(function () {})
      .then(function () {
        return fetch(PR.API.THREADS, {
          method: PR.HTTP.POST,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ comments: PR.state.comments }),
        });
      })
      .catch(function () {});
    return threadsSave;
  };

  /** Saves settings, one request at a time. */
  var settingsSave = Promise.resolve();
  PR.storeSettings = function () {
    var payload = Object.assign({}, PR.state.settings, { diffMode: PR.state.diffMode });
    // truth, because each review page lives on its own port and localStorage is scoped to the origin…
    try {
      localStorage.setItem(PR.SETTINGS_KEY, JSON.stringify(payload));
    } catch (e) {}

    settingsSave = settingsSave
      .catch(function () {})
      .then(function () {
        return fetch(PR.API.SETTINGS, {
          method: PR.HTTP.POST,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
      })
      .catch(function () {});
  };

  /** Loads the device-wide settings from the server. */
  PR.loadSettings = function () {
    return fetch(PR.API.SETTINGS)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok || !result.settings) return;
        var settings = result.settings;
        if (settings.diffMode) {
          PR.state.diffMode = settings.diffMode;
          delete settings.diffMode;
        }
        PR.state.settings = Object.assign(PR.state.settings, settings);
      })
      .catch(function () {});
  };

  /** Reads the device-wide settings, or an empty object when none were saved. */
  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(PR.SETTINGS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  /** Applies the device-wide settings, then the review's own saved copy. */
  function restoreSettings(saved) {
    var device = readSettings();
    // Old shape: settings lived inside the per-review entry.
    PR.state.settings = Object.assign(PR.state.settings, saved.settings || {});
    // `diffMode` is stored at the top of the device payload, not in `settings`.
    var deviceSettings = Object.assign({}, device);
    delete deviceSettings.diffMode;
    PR.state.settings = Object.assign(PR.state.settings, deviceSettings);
  }

  /** Reads the persisted review state, or an empty object when it is gone. */
  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(PR.STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  /** Restores the page state. */
  PR.restore = function () {
    var s = PR.state;
    var saved = {};
    try {
      var raw = localStorage.getItem(PR.STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : {};
    } catch (e) {
      saved = {};
    }

    try {
      if (Array.isArray(saved.comments)) s.comments = saved.comments;
      if (Array.isArray(saved.viewed)) s.viewed = new Set(saved.viewed);
      if (Array.isArray(saved.collapsed)) {
        // not undo that, otherwise every deleted file expands on reload.
        s.collapsed = new Set(saved.collapsed.concat(Array.from(s.collapsed)));
      }
      if (saved.lastViewedFile) s.lastViewedFile = saved.lastViewedFile;
      if (saved.commitLabels) s.commitLabels = saved.commitLabels;
      if (saved.commitUnlocked) s.commitUnlocked = saved.commitUnlocked;
      if (Array.isArray(saved.commitSelection)) s.commitSelection = saved.commitSelection;
      if (saved.tab) s.tab = saved.tab;
    } catch (e) {}
    // Settings, and the diff layout that goes with them, survive a new review.
    restoreSettings(saved);
    var device = readSettings();
    if (device.diffMode) s.diffMode = device.diffMode;
    else if (saved.diffMode) s.diffMode = saved.diffMode;

    PR.rebuildCommentMap();
  };

  /** -------------------------------- summary ------------------------------- */
  PR.renderSummary = function () {
    var s = PR.state;
    var open = s.comments.filter(function (c) { return c.resolved !== true; }).length;
    var resolved = s.comments.length - open;
    PR.setHtml(PR.els.headerSummary,
      '<span class="sum-item"><b>' + s.files.length + "</b> files</span>" +
      '<span class="sum-item"><b>' + s.viewed.size + "</b> / " + s.files.length + " viewed</span>" +
      '<span class="sum-item"><b>' + open + "</b> comments</span>" +
      (resolved ? '<span class="sum-item"><b>' + resolved + "</b> resolved</span>" : "")
    );
    var tabCount = document.getElementById("tab-files-count");
    if (tabCount) tabCount.textContent = s.files.length;
  };

  PR.renderProgress = function () {
    var s = PR.state;
    var pct = s.files.length ? (s.viewed.size / s.files.length) * 100 : 0;
    if (PR.els.progressFill) PR.els.progressFill.style.width = pct.toFixed(1) + "%";
    PR.setText(PR.els.progress2, s.viewed.size + " / " + s.files.length + " viewed");
  };

  PR.syncTabs = function () {
    var s = PR.state;
    PR.els.tabs.forEach(function (t) { t.classList.toggle("active", t.dataset.tab === s.tab); });
    PR.els.panelFiles.classList.toggle("hidden", s.tab !== PR.TAB.FILES);
    PR.els.panelCommits.classList.toggle("hidden", s.tab !== PR.TAB.COMMITS);
  };

  /** ----------------------------- file menu -------------------------------- */
  /** The open per-file menu, if any. */
  var openFileMenu = null;

  PR.closeFileMenus = function () {
    if (!openFileMenu) return;
    openFileMenu.pop.hidden = true;
    openFileMenu.button.setAttribute("aria-expanded", "false");
    // The section no longer needs to sit above its neighbours.
    var section = openFileMenu.button.closest(".diff-file");
    if (section) section.classList.remove("menu-open");
    openFileMenu = null;
  };

  /** Opens the clicked file's menu, closing whichever one was open. */
  PR.toggleFileMenu = function (button) {
    var pop = button.parentNode.querySelector(".file-menu-pop");
    if (!pop) return;

    var alreadyOpen = openFileMenu && openFileMenu.button === button;
    PR.closeFileMenus();
    if (alreadyOpen) return;

    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    // The header is sticky with its own z-index, so it forms a stacking context:
    // the popup inside it can never paint over the NEXT file's header, which has
    // the same z-index. Lifting the whole section for as long as the menu is
    // open is what makes the popup visible over the file below.
    var section = button.closest(".diff-file");
    if (section) section.classList.add("menu-open");
    openFileMenu = { button: button, pop: pop };
  };
  // A click anywhere else, Escape, or a scroll closes the menu.
  document.addEventListener("click", function (event) {
    if (!openFileMenu) return;
    if (event.target.closest(".file-menu")) return;
    PR.closeFileMenus();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") PR.closeFileMenus();
  });
  window.addEventListener("scroll", PR.closeFileMenus, true);
})();
