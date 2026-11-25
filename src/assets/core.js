
(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("pr-review-data").textContent);

  var PR = window.PR;
  PR.DATA = DATA;






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
    filterHits: null,
    filterScope: "changed",
    filterSearchSeq: 0,
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

    published: new Set((DATA.comments || []).filter(function (c) { return c.published === true; })
      .map(function (c) { return c.id; })),
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
      treeIndent: PR.TREE_SIZE.DEFAULT_INDENT,
      autoScrollTree: true,
      largeFileLines: 400,
      openLinksInline: true,

      contextCollapseLines: PR.CONTEXT.DEFAULT_COLLAPSE_LINES,

      viewFileMode: PR.VIEW_FILE_MODE.TAB,
      theme: PR.THEME.DARK,
    },

    expandedGaps: new Set(),
  };

  PR.state.files.forEach(function (f) { PR.state.changedMap[f.path] = f.status; });
  PR.state.comments.forEach(function (c) {
    var n = parseInt(String(c.id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= PR.state.nextId) PR.state.nextId = n + 1;
  });


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


  PR.escapeHtml = function (value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  };
  PR.setText = function (el, text) { if (el) el.textContent = text; };
  PR.setHtml = function (el, html) { if (el) el.innerHTML = html; };
  PR.cssEscape = function (value) { return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"'); };


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


  PR.pathHtml = function (path) {
    return PR.escapeHtml(path).replace(/\//g, "/<wbr>");
  };
  PR.findFile = function (path) {
    var files = PR.state.files;
    for (var i = 0; i < files.length; i += 1) if (files[i].path === path) return files[i];
    return null;
  };


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


  PR.rebuildCommentMap = function () {
    var map = {};
    PR.state.comments.forEach(function (c) { map[c.path] = (map[c.path] || 0) + 1; });
    PR.state.commentMap = map;
  };
  PR.rebuildCommentMap();


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


  function mergeComments(current, incoming) {
    var byKey = new Map();

    for (var i = 0; i < current.length; i += 1) {
      byKey.set(commentKey(current[i]), current[i]);
    }
    for (var j = 0; j < incoming.length; j += 1) {
      var comment = incoming[j];
      var key = commentKey(comment);

      if (!byKey.has(key) || comment.id !== byKey.get(key).id) byKey.set(key, comment);
    }

    return Array.from(byKey.values());
  }

  function commentKey(comment) {
    return [comment.path, comment.side || "", comment.lineStart, comment.lineEnd || comment.lineStart].join("|");
  }



  PR.store = function () {
    var s = PR.state;
    try {

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
        published: Array.from(s.published),
      }));

      PR.storeSettings();


      PR.saveThreads();
    } catch (e) {}
  };


  var threadsSave = Promise.resolve();
  PR.saveThreads = function () {
    threadsSave = threadsSave
      .catch(function () {})
      .then(function () {
        return fetch(PR.API.THREADS, {
          method: PR.HTTP.POST,
          headers: { "content-type": PR.HTTP.JSON },
          body: JSON.stringify({ comments: PR.state.comments }),
        });
      })
      .catch(function () {});
    return threadsSave;
  };


  var settingsSave = Promise.resolve();
  PR.storeSettings = function () {
    var payload = Object.assign({}, PR.state.settings, { diffMode: PR.state.diffMode });

    try {
      localStorage.setItem(PR.SETTINGS_KEY, JSON.stringify(payload));
    } catch (e) {}

    settingsSave = settingsSave
      .catch(function () {})
      .then(function () {
        return fetch(PR.API.SETTINGS, {
          method: PR.HTTP.POST,
          headers: { "content-type": PR.HTTP.JSON },
          body: JSON.stringify(payload),
        });
      })
      .catch(function () {});
  };


  PR.loadSettings = function () {
    return fetch(PR.API.SETTINGS)
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (!result || !result.ok || !result.settings) return;
        var settings = result.settings;
        if (settings.diffMode) {
          PR.state.diffMode = settings.diffMode;
        }
        // Server wins over anything local: it is the same person, the same
        // choices, and the only copy that survives a new port or browser.
        PR.state.settings = Object.assign(PR.state.settings, settings);
      })
      .catch(function () {});
  };


  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(PR.SETTINGS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }


  function restoreSettings(saved) {
    // The server copy is the source of truth: it follows the person across
    // reviews and ports. The browser copy only fills what the server does not
    // know yet, so a stale localStorage value never overrides a saved choice.
    var device = readSettings();
    PR.state.settings = Object.assign(PR.state.settings, device, saved.settings || {});
  }


  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(PR.STORAGE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }


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

        s.collapsed = new Set(saved.collapsed.concat(Array.from(s.collapsed)));
      }
      if (saved.lastViewedFile) s.lastViewedFile = saved.lastViewedFile;
      if (saved.commitLabels) s.commitLabels = saved.commitLabels;
      if (saved.commitUnlocked) s.commitUnlocked = saved.commitUnlocked;
      if (Array.isArray(saved.commitSelection)) s.commitSelection = saved.commitSelection;
      if (Array.isArray(saved.published)) s.published = new Set(saved.published);
      if (saved.tab) s.tab = saved.tab;
    } catch (e) {}

    restoreSettings(saved);
    var device = readSettings();
    if (device.diffMode) s.diffMode = device.diffMode;
    else if (saved.diffMode) s.diffMode = saved.diffMode;

    PR.rebuildCommentMap();
  };


  PR.renderSummary = function () {
    var s = PR.state;
    var open = s.comments.filter(function (c) { return c.resolved !== true; }).length;
    var resolved = s.comments.length - open;

    var item = function (count, one, many) {
      return '<span class="sum-item"><b>' + count + "</b> " + (count === 1 ? one : many) + "</span>";
    };
    PR.setHtml(PR.els.headerSummary,
      item(s.files.length, "file", "files") +
      '<span class="sum-item"><b>' + s.viewed.size + "</b> / " + s.files.length + " viewed</span>" +
      item(open, "comment", "comments") +
      (resolved ? item(resolved, "resolved", "resolved") : "")
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
    PR.els.panelFiles.classList.toggle(PR.SELECTORS.HIDDEN, s.tab !== PR.TAB.FILES);
    PR.els.panelCommits.classList.toggle(PR.SELECTORS.HIDDEN, s.tab !== PR.TAB.COMMITS);
  };



  var openFileMenu = null;

  PR.closeFileMenus = function () {
    if (!openFileMenu) return;
    openFileMenu.pop.hidden = true;
    openFileMenu.button.setAttribute("aria-expanded", "false");

    var section = openFileMenu.button.closest(".diff-file");
    if (section) section.classList.remove("menu-open");
    openFileMenu = null;
  };


  PR.toggleFileMenu = function (button) {
    var pop = button.parentNode.querySelector(".file-menu-pop");
    if (!pop) return;

    var alreadyOpen = openFileMenu && openFileMenu.button === button;
    PR.closeFileMenus();
    if (alreadyOpen) return;

    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");




    var section = button.closest(".diff-file");
    if (section) section.classList.add("menu-open");
    openFileMenu = { button: button, pop: pop };
  };

  document.addEventListener("click", function (event) {
    if (!openFileMenu) return;
    if (event.target.closest(".file-menu")) return;
    PR.closeFileMenus();
  });
  document.addEventListener(PR.EVENT.KEYDOWN, function (event) {
    if (event.key === PR.KEY.ESCAPE) PR.closeFileMenus();
  });
  window.addEventListener("scroll", PR.closeFileMenus, true);
})();
