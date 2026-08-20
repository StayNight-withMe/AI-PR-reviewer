/** Settings panel + theme. */
(function () {
  "use strict";

  var PR = window.PR;

  var FIELDS = {
    treeOpen: "set-tree-open",
    diffMode: "set-diff-mode",
    hideViewed: "set-hide-viewed",
    collapseViewed: "set-collapse-viewed",
    symbolLinks: "set-symlinks",
    sidebar: "set-sidebar",
    autoScrollTree: "set-autoscroll-tree",
    treeIndent: "set-tree-indent",
    openLinksInline: "set-inline-links",
    largeFileLines: "set-large-file-lines",
    contextCollapseLines: "set-context-collapse-lines",
    viewFileMode: "set-view-file-mode",
  };

  PR.applySettings = function () {
    var settings = PR.state.settings;
    document.documentElement.setAttribute("data-theme", settings.theme);

    setValue(FIELDS.treeOpen, settings.treeOpen);
    setValue(FIELDS.diffMode, PR.state.diffMode);
    setChecked(FIELDS.hideViewed, settings.hideViewed);
    setChecked(FIELDS.collapseViewed, settings.collapseViewed);
    setValue(FIELDS.symbolLinks, settings.symbolLinks);
    setChecked(FIELDS.sidebar, settings.showSidebar);
    setChecked(FIELDS.autoScrollTree, settings.autoScrollTree);
    setValue(FIELDS.treeIndent, String(settings.treeIndent));
    setChecked(FIELDS.openLinksInline, settings.openLinksInline);
    setValue(FIELDS.largeFileLines, settings.largeFileLines);
    setValue(FIELDS.contextCollapseLines, settings.contextCollapseLines);
    setValue(FIELDS.viewFileMode, settings.viewFileMode);

    document.body.classList.toggle("no-symlinks", settings.symbolLinks === "off");
    PR.applySidebar();
    PR.applyTreeIndent();
    PR.syncViewedToggle();
  };

  /** Indent size for the tree, in pixels per nesting level. */
  PR.applyTreeIndent = function () {
    var size = clampIndent(PR.state.settings.treeIndent);
    PR.state.settings.treeIndent = size;

    var tree = PR.els.tree;
    if (tree) tree.style.setProperty("--tree-indent", size + "px");

    var field = document.getElementById(FIELDS.treeIndent);
    if (field) field.value = String(size);
  };

  function clampIndent(value) {
    var size = Math.round(Number(value));
    if (!Number.isFinite(size) || size <= 0) return PR.TREE_SIZE.DEFAULT_INDENT;
    return Math.max(PR.TREE_SIZE.MIN_INDENT, Math.min(PR.TREE_SIZE.MAX_INDENT, size));
  }

  /** The toolbar button reflects the current filter instead of a fixed label. */
  PR.syncViewedToggle = function () {
    var button = document.getElementById("toggle-viewed");
    if (!button) return;
    var on = PR.state.settings.hideViewed;
    button.textContent = on ? PR.TOGGLE.SHOW_ALL : PR.TOGGLE.HIDE_VIEWED;
    button.setAttribute("aria-pressed", on ? "true" : "false");
  };

  function setValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
  }
  function setChecked(id, value) {
    var el = document.getElementById(id);
    if (el) el.checked = value;
  }

  PR.bindSettings = function () {
    var pop = PR.els.settingsPop;

    document.getElementById("btn-settings").addEventListener("click", function (event) {
      event.stopPropagation();
      pop.classList.toggle("show");
    });

    document.addEventListener("click", function (event) {
      if (!event.target.closest("#settings-pop") && !event.target.closest("#btn-settings")) {
        pop.classList.remove("show");
      }
    });

    pop.querySelectorAll(".js-close-settings").forEach(function (button) {
      button.addEventListener("click", function () { pop.classList.remove("show"); });
    });

    bindField(FIELDS.treeOpen, function (value) { PR.state.settings.treeOpen = value; });

    bindField(FIELDS.diffMode, function (value) {
      PR.state.diffMode = value;
      PR.renderFileList();
    });

    bindField(FIELDS.hideViewed, function (value) {
      PR.state.settings.hideViewed = value;
      PR.syncViewedToggle();
      PR.renderFileList();
    });

    bindField(FIELDS.collapseViewed, function (value) { PR.state.settings.collapseViewed = value; });

    bindField(FIELDS.symbolLinks, function (value) {
      PR.state.settings.symbolLinks = value;
      PR.applySettings();
      PR.renderFileList();
    });

    bindField(FIELDS.sidebar, function (value) {
      PR.state.settings.showSidebar = value;
      PR.applySidebar();
    });

    bindField(FIELDS.treeIndent, function (value) {
      PR.state.settings.treeIndent = Number(value);
      PR.applyTreeIndent();
    });
    // A number input only fires `change` on blur/Enter; apply while typing too.
    var indentField = document.getElementById(FIELDS.treeIndent);
    if (indentField) {
      indentField.addEventListener("input", function () {
        var raw = Number(indentField.value);
        if (!Number.isFinite(raw) || raw <= 0) return;
        PR.state.settings.treeIndent = raw;
        PR.applyTreeIndent();
      });
    }

    bindField(FIELDS.autoScrollTree, function (value) {
      PR.state.settings.autoScrollTree = value;
    });

    bindField(FIELDS.openLinksInline, function (value) {
      PR.state.settings.openLinksInline = value;
    });

    bindField(FIELDS.largeFileLines, function (value) {
      PR.state.settings.largeFileLines = Math.max(0, Number(value) || 0);
      PR.renderFileList();
    });

    bindField(FIELDS.contextCollapseLines, function (value) {
      PR.state.settings.contextCollapseLines = Math.max(0, Number(value) || 0);

      PR.renderFileList();
    });
    // A number input only fires `change` on blur/Enter; apply while typing too.
    var contextField = document.getElementById(FIELDS.contextCollapseLines);
    if (contextField) {
      contextField.addEventListener("input", function () {
        var raw = Number(contextField.value);
        if (!Number.isFinite(raw) || raw < 0) return;
        PR.state.settings.contextCollapseLines = raw;
      });
    }

    bindField(FIELDS.viewFileMode, function (value) {
      PR.state.settings.viewFileMode = value;
    });

    document.getElementById("btn-sidebar").addEventListener("click", function () {
      PR.state.settings.showSidebar = !PR.state.settings.showSidebar;
      PR.store();
      PR.applySettings();
    });

    document.getElementById("btn-theme").addEventListener("click", function () {
      PR.state.settings.theme = PR.state.settings.theme === PR.THEME.DARK ? PR.THEME.LIGHT : PR.THEME.DARK;
      PR.store();
      PR.applySettings();
    });
  };

  /** Sidebar visibility is a persisted layout choice, not a per-session tweak. */
  PR.applySidebar = function () {    var on = PR.state.settings.showSidebar;
    document.body.classList.toggle("no-sidebar", !on);
    var button = document.getElementById(PR.IDS.BTN_SIDEBAR);
    if (button) {
      button.textContent = on ? PR.TOGGLE.SIDEBAR_HIDE : PR.TOGGLE.SIDEBAR_SHOW;
      button.setAttribute("aria-pressed", on ? "true" : "false");
    }
    var field = document.getElementById(FIELDS.sidebar);
    if (field) field.checked = on;
  };

  function bindField(id, onChange) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", function () {
      var value = el.type === "checkbox" ? el.checked : el.value;
      onChange(value);
      PR.store();
    });
  }
})();
