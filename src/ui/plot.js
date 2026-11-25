// Spectrum plot (uPlot): axes, linear or log intensity, a held reference
// curve, cursor readout and mouse gestures. Overlays are drawn in plot-overlays.js, the overview in overview.js.
// Mouse: drag = select range, click = whole peak, edge drag, shift-drag pan, wheel zoom, double-click reset.
// Touch: one finger pans, two fingers pinch-zoom, tap = whole peak, double tap = reset.

import { peakExtent, evToNm, nmToEv } from "../analysis/peaks.js";
import { DEFAULT_RANGE, loadPeakColors } from "../config.js";
import { S, fromDisp, intensityUnit, toDisp, dispRange } from "../state.js";
import { $, clamp, cssVar, fmt } from "../util.js";
import { drawOverview, initOverview } from "./overview.js";
import { drawOverlays } from "./plot-overlays.js";
import { isCompact } from "./mobile.js";
import { markRows } from "./peaks.js";

let u = null;
let C = {}; // theme colours for canvas drawing
let H = {}; // handlers: { setSelection(a, b), clearSelection(), reanalyze(), hoverPeak(i) }

/** Create the first plot; `handlers` receive the selections made on it. */
export function initPlot(handlers) {
  H = handlers;
  createPlot(false);
  initOverview(setX);
  new ResizeObserver(() => {
    const el = $("plot");
    if (u && el.clientWidth && el.clientHeight) u.setSize({ width: el.clientWidth, height: el.clientHeight });
  }).observe($("plot"));
}

// ---------------------------------------------------------------- axes
const decimalsFor = (incr) => (!incr || incr >= 1 ? 0 : incr >= 0.1 ? 1 : incr >= 0.01 ? 2 : 3);

/**
 * Minimum gap between X ticks, from the width the labels will need: uPlot spaces ticks by a fixed
 * distance, so long labels (zoomed in: "546.25") or a narrow phone screen would make them overlap.
 */
function xSpace(_u, _axis, min, max, dim) {
  const incr = (max - min) / Math.max(dim / 70, 1);
  const chars = Math.max(String(Math.round(Math.abs(max))).length, String(Math.round(Math.abs(min))).length) + (decimalsFor(incr) ? decimalsFor(incr) + 1 : 0);
  return chars * (isCompact() ? 6.5 : 7) + (isCompact() ? 30 : 26);
}

function plainTicks(_u, splits, _axis, _space, incr) {
  const d = decimalsFor(incr);
  return splits.map((v) => v.toFixed(d));
}

/** Intensity ticks: 42 500 → 42.5k, 1 200 000 → 1.2M. A log axis passes null for unlabelled ticks. */
function compactTicks(_u, splits, _axis, _space, incr) {
  return splits.map((v) => {
    if (v == null) return null;
    const a = Math.abs(v);
    if (a >= 1e6) return `${+(v / 1e6).toFixed(incr >= 1e6 || !incr ? 0 : 1)}M`;
    if (a >= 1e4) return `${+(v / 1e3).toFixed(incr >= 1e3 || !incr ? 0 : 1)}k`;
    return v.toFixed(decimalsFor(incr));
  });
}

// ---------------------------------------------------------------- data
let nulls = [];
/** Series for uPlot: x, the spectrum and the held reference; a log scale needs positive values. */
function plotArrays() {
  if (!S.disp) return [[], [], []];
  const n = S.disp.x.length;
  const pos = (y) => (S.logY ? Float64Array.from(y, (v) => (v > 1 ? v : 1)) : y);
  let ref = S.refDisp && S.refDisp.y.length === n ? pos(S.refDisp.y) : null;
  if (!ref) {
    if (nulls.length !== n) nulls = new Array(n).fill(null);
    ref = nulls;
  }
  return [S.disp.x, pos(S.disp.y), ref];
}

/** (Re)build the plot, e.g. after a theme, unit or scale change; `keepX` / `keepY` keep the current zoom. */
export function createPlot(keepX, keepY = keepX) {
  const el = $("plot");
  const prevX = keepX && u ? [u.scales.x.min, u.scales.x.max] : null;
  const prevY = keepY && u ? [u.scales.y.min, u.scales.y.max] : null;
  if (u) u.destroy();
  loadPeakColors();
  C = {
    muted: cssVar("--muted"), grid: cssVar("--grid"), panel: cssVar("--panel"), hl: cssVar("--hl"),
    trace: cssVar("--trace"), border: cssVar("--border-strong"), text: cssVar("--text"), bad: cssVar("--bad"),
    font: cssVar("--font"), mono: cssVar("--font-mono"),
  };
  const small = isCompact();
  const axis = {
    stroke: C.muted, grid: { stroke: C.grid, width: 1 }, ticks: { stroke: C.grid, width: 1 },
    font: `${small ? 10 : 11}px ${C.mono}`, labelFont: `${small ? 11 : 12}px ${C.font}`, values: plainTicks,
  };
  const eV = S.unit === "eV";
  u = new uPlot({
    width: el.clientWidth || 600, height: el.clientHeight || 300,
    legend: { show: false },
    scales: { x: { time: false, auto: false }, y: { auto: false, distr: S.logY ? 3 : 1, log: 10 } },
    series: [
      {},
      { stroke: C.trace, width: 1.25, points: { show: false } },
      { stroke: C.muted, width: 1, dash: [5, 4], points: { show: false } },
    ],
    axes: [
      { ...axis, label: eV ? "Photon energy (eV)" : "Wavelength (nm)", labelSize: small ? 16 : 22, space: xSpace, size: small ? 40 : 50 },
      { ...axis, label: `Intensity (${intensityUnit()}${S.logY ? ", log" : ""})`, size: small ? 44 : 52, labelSize: small ? 16 : 22, values: compactTicks, space: small ? 26 : 30 },
    ],
    cursor: { drag: { x: true, y: false, setScale: false, dist: 4 }, points: { show: false } },
    hooks: {
      draw: [(uu) => { drawOverlays(uu, C); drawOverview(uu, C); }],
      setSelect: [onSelect], setCursor: [onCursor],
    },
  }, plotArrays(), el);
  installInteractions(u);

  const xr = prevX && prevX[0] != null ? prevX : (S.disp ? dataXRange() : DEFAULT_RANGE[S.unit]);
  let yr = prevY && prevY[0] != null ? prevY : (S.yRange || [0, S.fullScale * 1.05]);
  if (S.logY && yr[0] <= 0) yr = [1, 1e5];
  u.batch(() => {
    u.setScale("x", { min: xr[0], max: xr[1] });
    u.setScale("y", { min: yr[0], max: yr[1] });
  });
}

/** The full data range with a small margin. */
export function dataXRange() {
  const x = S.disp.x;
  const pad = 0.02 * (x[x.length - 1] - x[0]);
  return [x[0] - pad, x[x.length - 1] + pad];
}

/** Draw S.disp; `resetX` fits the X axis to the data, `autoY` rescales Y when needed. */
export function plotData(resetX, autoY) {
  u.batch(() => {
    u.setData(plotArrays(), false);
    let win;
    if (resetX) {
      win = dataXRange();
      u.setScale("x", { min: win[0], max: win[1] });
    }
    if (autoY) {
      const yr = autoscaleY(false, win);
      if (yr) u.setScale("y", { min: yr[0], max: yr[1] });
    }
  });
}

/** Redraw the overlays without new data. */
export const redrawPlot = () => u.redraw(false, false);

/** The plot canvas (axes, curves and overlays) for exporting an image. */
export const plotCanvas = () => u.ctx.canvas;

export function resetView() {
  S.yRange = null;
  if (S.focusPeak >= 0) {
    S.focusPeak = -1;
    markRows();
  }
  if (!S.disp) {
    const [a, b] = DEFAULT_RANGE[S.unit];
    u.setScale("x", { min: a, max: b });
    return;
  }
  const [a, b] = dataXRange();
  setX(a, b, true);
}

/**
 * Every change of the visible X range goes through here. uPlot applies scale changes later, so the
 * new window is passed on explicitly: Y is fitted to the data inside it (with Auto Y on, or `fit`).
 */
function setX(min, max, fit = $("autoY").checked) {
  u.batch(() => {
    u.setScale("x", { min, max });
    if (fit && S.disp) {
      const yr = autoscaleY(true, [min, max]);
      if (yr) u.setScale("y", { min: yr[0], max: yr[1] });
    }
  });
}

/** Zoom to a peak: ±3 FWHM (at least ±2 nm) around it, intensity fitted to that window. */
export function zoomToPeak(p) {
  const half = Math.max(3 * (Number.isFinite(p.fwhmNm) ? p.fwhmNm : 0), 2);
  const [a, b] = dispRange(p.measuredPeak - half, p.measuredPeak + half);
  setX(a, b, true);
}

/** Zoom to the selected range with a 5 % margin. */
export function zoomToSelection() {
  if (!S.sel) return;
  const [a, b] = dispRange(S.sel.lo, S.sel.hi);
  const pad = 0.05 * (b - a);
  setX(a - pad, b + pad, true);
}

/** Y range of the data in the visible X range; it only changes when the data no longer fits or the view is far too loose. */
function autoscaleY(force = false, win = [u.scales.x.min, u.scales.x.max]) {
  const { x, y } = S.disp;
  const [x0, x1] = win;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < y.length; i++) {
    if (x[i] < x0 || x[i] > x1) continue;
    const v = S.logY ? Math.max(y[i], 1) : y[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo > hi) return null; // nothing visible
  const cur = S.yRange;
  let want, fits, tooLoose;
  if (S.logY) {
    // Whole decades, so the ticks fall on 1, 10, 100 … with room below the baseline and above the strongest peak
    want = [10 ** Math.floor(Math.log10(Math.max(1, lo / 1.3))), 10 ** Math.ceil(Math.log10(hi * 1.3))];
    fits = cur && cur[0] <= lo && hi <= cur[1] / 1.15;
    tooLoose = cur && cur[1] / cur[0] > 30 * (want[1] / want[0]);
  } else {
    // Counts are not negative: start at zero unless a subtracted dark leaves noise just below it
    const span = Math.max(hi - lo, 50);
    want = [lo >= 0 ? Math.max(0, lo - 0.1 * span) : lo - 0.05 * span, hi + 0.18 * span];
    const h = cur ? cur[1] - cur[0] : 0;
    fits = cur && cur[0] <= lo && hi <= cur[1] - 0.05 * h;
    tooLoose = cur && (((hi - lo) < 0.45 * h && span > 50) || Math.max(hi - lo, 50) < 0.25 * h);
  }
  if (cur && !force && fits && !tooLoose) return null;
  S.yRange = want;
  return want;
}

// ---------------------------------------------------------------- cursor
/** Peak whose dot is within 12 px of the pointer, or -1. */
function peakAt(left, top) {
  let best = -1, bestD = 12;
  S.peaks.forEach((p, i) => {
    const v = S.logY ? Math.max(p.rawIntensity, 1) : p.rawIntensity;
    const d = Math.hypot(u.valToPos(toDisp(p.measuredPeak), "x") - left, u.valToPos(v, "y") - top);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

function onCursor(uu) {
  const left = uu.cursor.left;
  if (left == null || left < 0) {
    $("cursorRo").textContent = "";
    H.hoverPeak?.(-1);
    return;
  }
  H.hoverPeak?.(peakAt(left, uu.cursor.top));
  const xv = uu.posToVal(left, "x");
  const idx = uu.cursor.idx;
  const yv = idx != null && S.disp ? S.disp.y[idx] : null;
  const pos = S.unit === "eV"
    ? `${xv.toFixed(3)} eV  (${fmt(evToNm(xv), 2)} nm)`
    : `${xv.toFixed(2)} nm  (${fmt(nmToEv(xv), 3)} eV)`;
  $("cursorRo").textContent = yv == null ? pos : `${pos}  ·  ${yv.toFixed(0)} ${intensityUnit()}`;
}

// ---------------------------------------------------------------- mouse gestures
function hitEdge(px) {
  if (!S.sel) return null;
  let best = null;
  for (const bound of ["lo", "hi"]) {
    const d = Math.abs(u.valToPos(toDisp(S.sel[bound]), "x") - px);
    if (d <= 6 && (!best || d < best.d)) best = { bound, d };
  }
  return best;
}

function installInteractions(plot) {
  const over = plot.over;
  const pos = (e) => {
    const rect = over.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };
  let mode = null, down = null;

  plot.root.addEventListener("mousedown", (e) => {
    if (!over.contains(e.target)) return;
    const [x, y] = pos(e);
    down = { x, y, moved: false };
    const edge = e.button === 0 && !e.shiftKey ? hitEdge(x) : null;
    if (edge) {
      mode = { kind: "edge", bound: edge.bound };
    } else if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      mode = { kind: "pan", x0: x, min: plot.scales.x.min, max: plot.scales.x.max };
    } else {
      mode = null;
      return; // plain drag: uPlot draws the selection
    }
    e.stopPropagation();
    e.preventDefault();
    over.style.cursor = mode.kind === "pan" ? "grabbing" : "ew-resize";
  }, true);

  const onMove = (e) => {
    if (!down) {
      if (over.contains(e.target)) over.style.cursor = hitEdge(pos(e)[0]) ? "ew-resize" : "";
      return;
    }
    const [x, y] = pos(e);
    if (Math.hypot(x - down.x, y - down.y) > 4) down.moved = true;
    if (!mode) return;
    if (mode.kind === "edge") {
      const nm = fromDisp(plot.posToVal(clamp(x, 0, over.clientWidth), "x"));
      if (Number.isFinite(nm) && S.sel) {
        S.sel[mode.bound] = nm;
        H.reanalyze();
      }
    } else {
      const dv = ((x - mode.x0) * (mode.max - mode.min)) / over.clientWidth;
      setX(mode.min - dv, mode.max - dv);
    }
  };

  const onUp = (e) => {
    if (!down) return;
    if (mode?.kind === "edge" && S.sel) {
      H.setSelection(S.sel.lo, S.sel.hi);
    } else if (!mode && !down.moved && e.button === 0) {
      handleClick(down.x);
    }
    mode = null;
    down = null;
    over.style.cursor = "";
  };

  plot.root.addEventListener("dblclick", (e) => {
    if (!over.contains(e.target)) return;
    e.stopPropagation();
    resetView();
  }, true);

  over.addEventListener("wheel", (e) => {
    e.preventDefault();
    const { min, max } = plot.scales.x;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dv = (e.deltaX * (max - min)) / over.clientWidth;
      setX(min + dv, max + dv);
      return;
    }
    const xv = plot.posToVal(pos(e)[0], "x");
    const f = Math.exp(clamp(e.deltaY, -100, 100) * 0.002);
    setX(xv - (xv - min) * f, xv + (max - xv) * f);
  }, { passive: false });

  installTouch(plot);

  // Listeners on window outlive a re-created plot; replace the previous ones
  window.removeEventListener("mousemove", installInteractions.move);
  window.removeEventListener("mouseup", installInteractions.up);
  installInteractions.move = onMove;
  installInteractions.up = onUp;
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/** Touch gestures on the plot. preventDefault keeps the page still and stops emulated mouse events. */
function installTouch(plot) {
  const over = plot.over;
  const xOf = (t) => t.clientX - over.getBoundingClientRect().left;
  let g = null, lastTap = { t: 0, x: -99 };

  const begin = (e) => {
    const { min, max } = plot.scales.x;
    if (e.touches.length >= 2) {
      const a = xOf(e.touches[0]), b = xOf(e.touches[1]);
      g = { kind: "pinch", d0: Math.max(Math.abs(a - b), 20), anchor: plot.posToVal((a + b) / 2, "x"), min, max };
    } else if (e.touches.length === 1) {
      g = { kind: "pan", x0: xOf(e.touches[0]), min, max, moved: false, t0: performance.now(), fresh: !g };
    } else g = null;
  };

  over.addEventListener("touchstart", (e) => { e.preventDefault(); begin(e); }, { passive: false });
  over.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!g) return;
    const W = over.clientWidth;
    if (g.kind === "pan" && e.touches.length === 1) {
      const dx = xOf(e.touches[0]) - g.x0;
      if (Math.abs(dx) > 6) g.moved = true;
      if (!g.moved) return;
      const dv = (dx * (g.max - g.min)) / W;
      setX(g.min - dv, g.max - dv);
    } else if (g.kind === "pinch" && e.touches.length >= 2) {
      const a = xOf(e.touches[0]), b = xOf(e.touches[1]);
      const w = ((g.max - g.min) * g.d0) / Math.max(Math.abs(a - b), 20);
      const min = g.anchor - ((a + b) / 2 / W) * w;
      setX(min, min + w);
    }
  }, { passive: false });
  over.addEventListener("touchend", (e) => {
    e.preventDefault();
    // A quick touch that did not move, and was not the end of a pinch, is a tap
    if (g?.kind === "pan" && g.fresh && !g.moved && performance.now() - g.t0 < 350 && e.touches.length === 0) {
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.abs(g.x0 - lastTap.x) < 30) {
        resetView();
        lastTap = { t: 0, x: -99 };
      } else {
        handleClick(g.x0);
        lastTap = { t: now, x: g.x0 };
      }
    }
    if (e.touches.length) begin(e); // a finger lifted from a pinch: carry on panning
    else g = null;
  }, { passive: false });
  over.addEventListener("touchcancel", () => { g = null; });
}

function onSelect(plot) {
  const { left, width } = plot.select;
  if (width >= 4) {
    const a = fromDisp(plot.posToVal(left, "x")), b = fromDisp(plot.posToVal(left + width, "x"));
    if (Number.isFinite(a) && Number.isFinite(b)) H.setSelection(a, b);
  }
  plot.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
}

function handleClick(px) {
  if (!S.frame) return;
  const xv = u.posToVal(px, "x");
  const nearNm = fromDisp(xv);
  if (!Number.isFinite(nearNm)) return;
  // On a peak: select the whole peak; on empty baseline outside the selection: clear it
  const tol = (12 * (u.scales.x.max - u.scales.x.min)) / u.over.clientWidth; // ~12 screen px
  const searchNm = Math.abs(fromDisp(Math.max(xv - tol, 1e-6)) - fromDisp(xv + tol)) / 2;
  const ext = peakExtent(S.frame.wl, S.frame.inten, nearNm, { searchNm });
  if (ext) H.setSelection(ext[0], ext[1]);
  else if (S.sel && (nearNm < S.sel.lo || nearNm > S.sel.hi)) H.clearSelection();
}
