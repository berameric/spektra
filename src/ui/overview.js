// Overview under the plot while it is zoomed in: the whole spectrum with the visible window marked.
// Drag the window to pan; click elsewhere to centre the view there.

import { S } from "../state.js";
import { $, withAlpha } from "../util.js";

let setXRange = null;
let view = null; // last drawn mapping: { x0, x1, min, max }

/** `setX(min, max)` moves the plot's visible range. */
export function initOverview(setX) {
  setXRange = setX;
  const canvas = $("ovCanvas");
  const valueAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return view.x0 + ((e.clientX - r.left) / r.width) * (view.x1 - view.x0);
  };
  let grab = null; // pointer offset from the window's left edge, in X units
  canvas.addEventListener("pointerdown", (e) => {
    if (!view) return;
    canvas.setPointerCapture(e.pointerId);
    const v = valueAt(e), w = view.max - view.min;
    grab = v >= view.min && v <= view.max ? v - view.min : w / 2;
    setXRange(v - grab, v - grab + w);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (grab === null || !canvas.hasPointerCapture(e.pointerId)) return;
    const v = valueAt(e), w = view.max - view.min;
    setXRange(v - grab, v - grab + w);
  });
  const end = () => { grab = null; canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
}

/** Called after every plot draw: show the overview only while zoomed in, aligned with the plotting area. */
export function drawOverview(u, C) {
  const box = $("overview");
  const x = S.disp?.x;
  const min = u.scales.x.min, max = u.scales.x.max;
  const zoomed = !!x && x.length > 1 && (max - min) < 0.97 * (x[x.length - 1] - x[0]);
  $("plotWrap").classList.toggle("zoomed", zoomed);
  box.hidden = !zoomed;
  if (!zoomed) { view = null; return; }

  const pr = uPlot.pxRatio;
  box.style.left = `${4 + u.bbox.left / pr}px`;
  box.style.width = `${u.bbox.width / pr}px`;
  const canvas = $("ovCanvas");
  const W = Math.round(canvas.clientWidth * pr), Hh = Math.round(canvas.clientHeight * pr);
  if (!W || !Hh) return;
  if (canvas.width !== W || canvas.height !== Hh) { canvas.width = W; canvas.height = Hh; }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, Hh);

  const y = S.disp.y, x0 = x[0], x1 = x[x.length - 1];
  let lo = Infinity, hi = -Infinity;
  for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1, pad = 4 * pr;
  const PX = (v) => ((v - x0) / (x1 - x0)) * W;
  const PY = (v) => Hh - pad - ((v - lo) / span) * (Hh - 2 * pad);

  // Whole spectrum, decimated to about one point per pixel column
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = 1 * pr;
  ctx.beginPath();
  const stride = Math.max(1, Math.floor(y.length / W));
  for (let i = 0; i < y.length; i += stride) {
    let m = y[i];
    for (let k = 1; k < stride && i + k < y.length; k++) m = Math.max(m, y[i + k]);
    if (i === 0) ctx.moveTo(PX(x[i]), PY(m)); else ctx.lineTo(PX(x[i]), PY(m));
  }
  ctx.stroke();

  // Visible window: everything outside it dimmed
  const a = Math.max(0, PX(min)), b = Math.min(W, PX(max));
  ctx.fillStyle = withAlpha(C.panel.startsWith("#") ? C.panel : "#000000", 0.6);
  ctx.fillRect(0, 0, a, Hh);
  ctx.fillRect(b, 0, W - b, Hh);
  ctx.strokeStyle = C.text;
  ctx.lineWidth = 1.5 * pr;
  ctx.strokeRect(a + 0.75 * pr, 0.75 * pr, Math.max(b - a - 1.5 * pr, 2 * pr), Hh - 1.5 * pr);
  view = { x0, x1, min, max };
}
