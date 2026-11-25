// Spectrum plot (uPlot): axes, overlays for the selection and peaks, cursor readout and mouse gestures.
// Mouse: drag = select range, click = whole peak, edge drag, shift-drag pan, wheel zoom, double-click reset.

import { peakExtent, evToNm, nmToEv } from "../analysis/peaks.js";
import { DEFAULT_RANGE, peakColor } from "../config.js";
import { S, dispRange, fromDisp, intensityUnit, toDisp } from "../state.js";
import { $, clamp, cssVar, fmt, withAlpha } from "../util.js";

let u = null;
let C = {}; // theme colours for canvas drawing
let H = {}; // selection handlers: { setSelection(a, b), clearSelection(), reanalyze() }

/** Create the first plot; `handlers` receive the selections made on it. */
export function initPlot(handlers) {
  H = handlers;
  createPlot(false);
  new ResizeObserver(() => {
    const el = $("plot");
    if (u && el.clientWidth && el.clientHeight) u.setSize({ width: el.clientWidth, height: el.clientHeight });
  }).observe($("plot"));
}

function plainTicks(_u, splits, _axis, _space, incr) {
  const d = incr >= 1 ? 0 : incr >= 0.1 ? 1 : incr >= 0.01 ? 2 : 3;
  return splits.map((v) => v.toFixed(d));
}

/** (Re)build the plot, e.g. after a theme or unit change; `keepX` / `keepY` keep the current zoom. */
export function createPlot(keepX, keepY = keepX) {
  const el = $("plot");
  const prevX = keepX && u ? [u.scales.x.min, u.scales.x.max] : null;
  const prevY = keepY && u ? [u.scales.y.min, u.scales.y.max] : null;
  if (u) u.destroy();
  C = {
    muted: cssVar("--muted"), grid: cssVar("--grid"), panel: cssVar("--panel"), hl: cssVar("--hl"),
    trace: cssVar("--trace"),
    font: cssVar("--font"), mono: cssVar("--font-mono"),
  };
  const axis = {
    stroke: C.muted, grid: { stroke: C.grid, width: 1 }, ticks: { stroke: C.grid, width: 1 },
    font: `11px ${C.mono}`, labelFont: `12px ${C.font}`, values: plainTicks,
  };
  u = new uPlot({
    width: el.clientWidth || 600, height: el.clientHeight || 300,
    legend: { show: false },
    scales: { x: { time: false, auto: false }, y: { auto: false } },
    series: [{}, { stroke: C.trace, width: 1.25, points: { show: false } }],
    axes: [
      { ...axis, label: S.unit === "eV" ? "Photon energy (eV)" : "Wavelength (nm)", labelSize: 22 },
      { ...axis, label: `Intensity (${intensityUnit()})`, size: 64, labelSize: 22 },
    ],
    cursor: { drag: { x: true, y: false, setScale: false, dist: 4 }, points: { show: false } },
    hooks: { draw: [drawOverlays], setSelect: [onSelect], setCursor: [onCursor] },
  }, S.disp ? [S.disp.x, S.disp.y] : [[], []], el);
  installInteractions(u);

  const xr = prevX && prevX[0] != null ? prevX : (S.disp ? dataXRange() : DEFAULT_RANGE[S.unit]);
  const yr = prevY && prevY[0] != null ? prevY : (S.yRange || [0, 65535 * 1.05]);
  u.batch(() => {
    u.setScale("x", { min: xr[0], max: xr[1] });
    u.setScale("y", { min: yr[0], max: yr[1] });
  });
}

function dataXRange() {
  const x = S.disp.x;
  const pad = 0.02 * (x[x.length - 1] - x[0]);
  return [x[0] - pad, x[x.length - 1] + pad];
}

/** Draw S.disp; `resetX` fits the X axis to the data, `autoY` rescales Y when needed. */
export function plotData(resetX, autoY) {
  u.batch(() => {
    u.setData([S.disp.x, S.disp.y], false);
    if (resetX) {
      const [a, b] = dataXRange();
      u.setScale("x", { min: a, max: b });
    }
    if (autoY) {
      const yr = autoscaleY();
      if (yr) u.setScale("y", { min: yr[0], max: yr[1] });
    }
  });
}

/** Redraw the overlays without new data. */
export const redrawPlot = () => u.redraw(false, false);

export function resetView() {
  S.yRange = null;
  if (!S.disp) {
    const [a, b] = DEFAULT_RANGE[S.unit];
    u.setScale("x", { min: a, max: b });
    return;
  }
  const [a, b] = dataXRange();
  u.batch(() => {
    u.setScale("x", { min: a, max: b });
    const yr = autoscaleY(true);
    if (yr) u.setScale("y", { min: yr[0], max: yr[1] });
  });
}

/** Y range that only changes when the data no longer fits or the view is far too loose. */
function autoscaleY(force = false) {
  const y = S.disp.y;
  let lo = Infinity, hi = -Infinity;
  for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = Math.max(hi - lo, 50);
  const want = [lo - 0.1 * span, hi + 0.18 * span];
  const cur = S.yRange;
  if (cur && !force) {
    const h = cur[1] - cur[0];
    const fits = cur[0] <= lo && hi <= cur[1] - 0.05 * h;
    const tooLoose = ((hi - lo) < 0.45 * h && span > 50) || Math.max(hi - lo, 50) < 0.25 * h;
    if (fits && !tooLoose) return null;
  }
  S.yRange = want;
  return want;
}

// ---------------------------------------------------------------- overlays drawn on the uPlot canvas
function drawOverlays(u) {
  const ctx = u.ctx, bbox = u.bbox, pr = uPlot.pxRatio;
  const X = (v) => u.valToPos(v, "x", true), Y = (v) => u.valToPos(v, "y", true);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();

  // Selected range
  if (S.sel) {
    const [a, b] = dispRange(S.sel.lo, S.sel.hi);
    const x1 = X(a), x2 = X(b);
    ctx.fillStyle = withAlpha(C.hl, 0.12);
    ctx.fillRect(x1, bbox.top, x2 - x1, bbox.height);
    ctx.strokeStyle = C.hl;
    ctx.lineWidth = 1.5 * pr;
    ctx.beginPath();
    ctx.moveTo(x1, bbox.top); ctx.lineTo(x1, bbox.top + bbox.height);
    ctx.moveTo(x2, bbox.top); ctx.lineTo(x2, bbox.top + bbox.height);
    ctx.stroke();
  }

  // Detected peaks: colour-coded dots only (the list carries the numbers and values)
  S.peaks.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(X(toDisp(p.measuredPeak)), Y(p.rawIntensity), (i === S.mainPeak ? 6 : 4.5) * pr, 0, 2 * Math.PI);
    ctx.fillStyle = peakColor(i);
    ctx.fill();
    ctx.lineWidth = 1.5 * pr;
    ctx.strokeStyle = C.panel;
    ctx.stroke();
  });
  ctx.restore();
}

function onCursor(u) {
  const left = u.cursor.left;
  if (left == null || left < 0) { $("cursorRo").textContent = ""; return; }
  const xv = u.posToVal(left, "x");
  const idx = u.cursor.idx;
  const yv = idx != null && u.data[1].length ? u.data[1][idx] : null;
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
      plot.setScale("x", { min: mode.min - dv, max: mode.max - dv });
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
      plot.setScale("x", { min: min + dv, max: max + dv });
      return;
    }
    const xv = plot.posToVal(pos(e)[0], "x");
    const f = Math.exp(clamp(e.deltaY, -100, 100) * 0.002);
    plot.setScale("x", { min: xv - (xv - min) * f, max: xv + (max - xv) * f });
  }, { passive: false });

  // Listeners on window outlive a re-created plot; replace the previous ones
  window.removeEventListener("mousemove", installInteractions.move);
  window.removeEventListener("mouseup", installInteractions.up);
  installInteractions.move = onMove;
  installInteractions.up = onUp;
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
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
