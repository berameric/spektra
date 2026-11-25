// Peaks panel layout: drag its left edge to resize, collapse it to a strip (button or P). Remembered.

import { STORE_RAIL } from "../config.js";
import { $, clamp, store } from "../util.js";

const MIN_W = 300;
const work = () => document.querySelector(".work");
const maxWidth = () => Math.min(760, Math.round(innerWidth * 0.6));

function setWidth(w) {
  if (w) work().style.setProperty("--rail-open", `${w}px`);
  else work().style.removeProperty("--rail-open");
}

export function setRailCollapsed(collapsed) {
  work().classList.toggle("rail-collapsed", collapsed);
  const w = parseFloat(work().style.getPropertyValue("--rail-open"));
  store.set(STORE_RAIL, collapsed ? "collapsed" : w ? String(w) : "");
}

export function initRail() {
  const saved = store.get(STORE_RAIL);
  if (saved === "collapsed") work().classList.add("rail-collapsed");
  else if (+saved) setWidth(clamp(+saved, MIN_W, maxWidth()));

  const handle = $("railResize");
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    work().classList.add("resizing");
  });
  handle.addEventListener("pointermove", (e) => {
    if (handle.hasPointerCapture(e.pointerId)) setWidth(clamp(innerWidth - e.clientX, MIN_W, maxWidth()));
  });
  handle.addEventListener("pointerup", () => {
    work().classList.remove("resizing");
    setRailCollapsed(false);
  });
  handle.addEventListener("dblclick", () => {
    setWidth(0);
    setRailCollapsed(false);
  });

  $("railCollapse").addEventListener("click", () => setRailCollapsed(true));
  $("railExpand").addEventListener("click", () => setRailCollapsed(false));
  document.addEventListener("keydown", (e) => {
    if ((e.key === "p" || e.key === "P") && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest?.("input, dialog")) {
      setRailCollapsed(!work().classList.contains("rail-collapsed"));
    }
  });
}
