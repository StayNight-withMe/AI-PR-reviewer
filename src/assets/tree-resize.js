
(function () {
  "use strict";

  var PR = window.PR;

  var drag = null;

  function layout() { return document.querySelector(".gh-layout"); }
  function resizer() { return document.getElementById(PR.IDS.TREE_RESIZER); }
  function reveal() { return document.getElementById(PR.IDS.TREE_REVEAL); }


  PR.applyTreeWidth = function () {
    var width = PR.state.settings.treeWidth;
    var hidden = PR.state.settings.treeHidden;
    var box = layout();

    if (box) {
      box.style.setProperty("--tree-width", width + "px");
      box.classList.toggle("tree-hidden", hidden);
    }

    var button = reveal();
    if (button) button.hidden = !hidden;
  };

  PR.setTreeWidth = function (width) {
    var clamped = Math.max(PR.TREE_SIZE.MIN_WIDTH, Math.min(PR.TREE_SIZE.MAX_WIDTH, Math.round(width)));
    PR.state.settings.treeWidth = clamped;
    PR.state.settings.treeHidden = false;
    PR.store();
    PR.applyTreeWidth();
  };


  PR.hideTree = function () {
    PR.state.settings.treeHidden = true;
    PR.store();
    PR.applyTreeWidth();
  };

  PR.showTree = function () {
    PR.state.settings.treeHidden = false;
    PR.store();
    PR.applyTreeWidth();
  };

  PR.bindTreeResize = function () {
    var handle = resizer();
    var button = reveal();
    if (!handle) return;

    handle.addEventListener(PR.EVENT.MOUSEDOWN, function (event) {
      if (event.button !== 0) return;

      event.preventDefault();
      drag = { startX: event.clientX, startWidth: PR.state.settings.treeWidth };
      handle.classList.add("is-dragging");
      document.body.classList.add("is-resizing-tree");
    });

    document.addEventListener("mousemove", function (event) {
      if (!drag) return;

      var next = drag.startWidth + (event.clientX - drag.startX);

      drag.pending = next;
      if (drag.frame) return;

      drag.frame = window.requestAnimationFrame(function () {
        drag.frame = null;
        if (!drag) return;

        var value = drag.pending;
        if (value < PR.TREE_SIZE.SNAP_WIDTH) {
          endDrag();
          PR.hideTree();
          return;
        }
        PR.state.settings.treeWidth = Math.max(
          PR.TREE_SIZE.MIN_WIDTH,
          Math.min(PR.TREE_SIZE.MAX_WIDTH, Math.round(value)),
        );
        PR.applyTreeWidth();
      });
    });

    document.addEventListener(PR.EVENT.MOUSEUP, function () {
      if (!drag) return;
      var changed = PR.state.settings.treeWidth !== drag.startWidth;
      endDrag();
      if (changed) PR.store();
    });

    handle.addEventListener("dblclick", function () {
      PR.setTreeWidth(PR.TREE_SIZE.DEFAULT_WIDTH);
    });

    handle.addEventListener(PR.EVENT.KEYDOWN, function (event) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      var delta = event.key === "ArrowLeft" ? -PR.TREE_SIZE.KEYBOARD_STEP : PR.TREE_SIZE.KEYBOARD_STEP;
      var next = PR.state.settings.treeWidth + delta;
      if (next < PR.TREE_SIZE.SNAP_WIDTH) PR.hideTree();
      else PR.setTreeWidth(next);
    });

    if (button) button.addEventListener("click", PR.showTree);
  };

  function endDrag() {
    if (drag && drag.frame) window.cancelAnimationFrame(drag.frame);
    drag = null;
    var handle = resizer();
    if (handle) handle.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing-tree");
  }
})();
