// Spektra, browser software for the Ocean Insight HDX: live uPlot spectrum, nm/eV axis, range selection and peak detection.

import { HDXUSB } from "./hdx-usb.js";
import { boxcar, estimateBaseline, evToNm, findSpectralPeaks, nmToEv, peakExtent } from "./analysis.js";

const $ = (id) => document.getElementById(id);
const MIN_INT_MS = 6, MAX_INT_MS = 10000;
const INT_STEPS = [6, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const SATURATION = 65000; // 16-bit ADC
const AUTO_INT_TARGET = 0.8, AUTO_INT_BAND = [0.6, 0.9]; // highest peak as a fraction of full scale
const STORE_THEME = "hdx.theme";
const DEFAULT_RANGE = { nm: [200, 1100], eV: [1.1, 6.2] };
// Automatic detection: every peak 5x above the noise and 1 % of the strongest one, no count limit
const AUTO_PEAKS = { maxPeaks: Infinity, minSnr: 5, minProminenceFrac: 0.01 };
// Peak colours (cycled by wavelength order); the same colour marks a peak on the plot and in the list
const PEAK_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#eab308", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#6366f1", "#14b8a6"];
const peakColor = (i) => PEAK_COLORS[i % PEAK_COLORS.length];

// ---------------------------------------------------------------- state
const S = {
  dev: null, wl: null, intMs: 100, unit: "nm",
  avg: 1, boxcar: 0, autoInt: false,
  dark: null, darkIntMs: null, subtractDark: true,
  live: false, busy: false, measuringDark: false, scans: 0, fps: 0, saturated: false,
  frame: null, // {wl, raw, inten, rawMax, meta}
  disp: null,  // {x, y} in the display unit, x ascending
  sel: null,   // selected range {lo, hi} in nm; never stored
  detect: false,
  peaks: [],    // detected peaks, ascending wavelength
  mainPeak: -1, // index of the strongest detected peak
  yRange: null,
};

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
store.remove("hdx.rois.v1"); // saved regions of an earlier version

// ---------------------------------------------------------------- helpers
const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const toDisp = (nm) => (S.unit === "eV" ? nmToEv(nm) : nm);
const fromDisp = (x) => (S.unit === "eV" ? evToNm(x) : x);
const dispRange = (loNm, hiNm) => {
  const a = toDisp(loNm), b = toDisp(hiNm);
  return a < b ? [a, b] : [b, a];
};
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function withAlpha(color, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const toastsByKey = new Map();

/** Short notification. Toasts with the same key replace each other instead of stacking. */
function toast(msg, kind = "info", ms = 4500, key = null) {
  let d = key && toastsByKey.get(key);
  if (!d) {
    d = document.createElement("div");
    $("toasts").append(d);
    if (key) toastsByKey.set(key, d);
  }
  d.className = `toast ${kind}`;
  d.textContent = msg;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => {
    if (key) toastsByKey.delete(key);
    d.classList.add("out");
    setTimeout(() => d.remove(), 300);
  }, ms);
}

function confirmDialog(title, text) {
  const d = $("dlg");
  $("dlgTitle").textContent = title;
  $("dlgText").textContent = text;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}

// ---------------------------------------------------------------- theme
function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

const savedTheme = store.get(STORE_THEME);
if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;

$("themeBtn").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store.set(STORE_THEME, next);
  createPlot(true);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!document.documentElement.dataset.theme) createPlot(true);
});

// ---------------------------------------------------------------- plot
let u = null;
let C = {}; // theme colours for canvas drawing

function plainTicks(_u, splits, _axis, _space, incr) {
  const d = incr >= 1 ? 0 : incr >= 0.1 ? 1 : incr >= 0.01 ? 2 : 3;
  return splits.map((v) => v.toFixed(d));
}

function createPlot(keepView) {
  const el = $("plot");
  const prevX = keepView && u ? [u.scales.x.min, u.scales.x.max] : null;
  const prevY = keepView && u ? [u.scales.y.min, u.scales.y.max] : null;
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
      { ...axis, label: "Intensity (counts)", size: 64, labelSize: 22 },
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

new ResizeObserver(() => {
  const el = $("plot");
  if (u && el.clientWidth && el.clientHeight) u.setSize({ width: el.clientWidth, height: el.clientHeight });
}).observe($("plot"));

function resetView() {
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

// ---- overlays drawn on the uPlot canvas
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
  $("cursorRo").textContent = yv == null ? pos : `${pos}  ·  ${yv.toFixed(0)} counts`;
}

// ---- mouse: drag = select range, click = whole peak, edge drag, shift-drag pan, wheel zoom
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
        reanalyze();
      }
    } else {
      const dv = ((x - mode.x0) * (mode.max - mode.min)) / over.clientWidth;
      plot.setScale("x", { min: mode.min - dv, max: mode.max - dv });
    }
  };

  const onUp = (e) => {
    if (!down) return;
    if (mode?.kind === "edge" && S.sel) {
      setSelection(S.sel.lo, S.sel.hi);
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
    if (Number.isFinite(a) && Number.isFinite(b)) setSelection(a, b);
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
  if (ext) setSelection(ext[0], ext[1]);
  else if (S.sel && (nearNm < S.sel.lo || nearNm > S.sel.hi)) clearSelection();
}

// ---------------------------------------------------------------- selection
function setSelection(a, b) {
  S.sel = { lo: Math.min(a, b), hi: Math.max(a, b) };
  reanalyze();
}

function clearSelection() {
  if (!S.sel) return;
  S.sel = null;
  reanalyze();
}

function updateSelChip() {
  $("selChip").hidden = !S.sel;
  if (!S.sel) return;
  const d = S.unit === "eV" ? 3 : 2;
  const [a, b] = dispRange(S.sel.lo, S.sel.hi);
  $("selText").textContent = `${a.toFixed(d)} – ${b.toFixed(d)} ${S.unit}`;
}

// ---------------------------------------------------------------- peaks list
const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

function updatePeakList() {
  const list = $("peakList");
  while (list.children.length > S.peaks.length) list.lastElementChild.remove();
  while (list.children.length < S.peaks.length) {
    const li = document.createElement("li");
    li.className = "pk";
    li.innerHTML = '<span class="pdot"></span><span class="n"></span><span class="wl"></span><span class="ct"></span><span class="sub"></span>';
    list.append(li);
  }
  S.peaks.forEach((p, i) => {
    const li = list.children[i];
    const [dot, n, wl, ct, sub] = li.children;
    const strongest = i === S.mainPeak;
    li.classList.toggle("max", strongest);
    dot.style.background = peakColor(i);
    setText(n, String(i + 1));
    const wlText = S.unit === "eV" ? `${fmt(p.energyEv, 4)} eV` : `${fmt(p.measuredPeak, 3)} nm`;
    if (wl.dataset.v !== wlText) {
      wl.dataset.v = wlText;
      const [num, unit] = wlText.split(" ");
      wl.innerHTML = `${num}<small>${unit}</small>`;
    }
    const counts = p.rawIntensity.toFixed(0);
    if (ct.dataset.v !== counts) {
      ct.dataset.v = counts;
      ct.innerHTML = `${counts}<small>cts</small>`;
    }
    const other = S.unit === "eV" ? `${fmt(p.measuredPeak, 2)} nm` : `${fmt(p.energyEv, 4)} eV`;
    const fwhm = S.unit === "eV" ? `${fmt(p.fwhmEv, 4)} eV` : `${fmt(p.fwhmNm, 2)} nm`;
    setText(sub, `${other} · FWHM ${fwhm} · SNR ${p.snr.toFixed(0)}`);
    li.title = `${strongest ? "Strongest peak · " : ""}area ${fmt(p.integratedIntensity, 0)}`;
  });
  setText($("peakCount"), String(S.peaks.length));
  $("peaksCsvBtn").disabled = !S.peaks.length;
  $("peakEmpty").hidden = S.peaks.length > 0;
  $("peakEmpty").innerHTML = !S.detect
    ? "<b>Peak detection is off</b>Turn on Detect to find every peak and list it here."
    : !S.frame ? "<b>No spectrum yet</b>Peaks appear as soon as a spectrum is acquired."
      : S.sel ? "<b>No peaks in the selection</b>Widen the range or clear it with Esc."
        : "<b>No peaks found</b>The spectrum has no line above the noise.";
}


// ---------------------------------------------------------------- frames & rendering
function toDisplay(wl, inten) {
  if (S.unit === "nm") return { x: wl, y: inten };
  const idx = [];
  for (let i = 0; i < wl.length; i++) if (wl[i] > 0) idx.push(i);
  idx.sort((a, b) => wl[b] - wl[a]); // ascending energy
  return { x: Float64Array.from(idx, (i) => nmToEv(wl[i])), y: Float64Array.from(idx, (i) => inten[i]) };
}

function analyze() {
  const f = S.frame;
  // Selected range: search only there; no selection: the whole spectrum
  const range = { wlMin: S.sel?.lo ?? null, wlMax: S.sel?.hi ?? null };
  S.peaks = [];
  S.mainPeak = -1;
  if (S.detect) {
    S.peaks = findSpectralPeaks(f.wl, f.inten, { ...AUTO_PEAKS, ...range })
      .sort((a, b) => a.measuredPeak - b.measuredPeak);
    S.peaks.forEach((p, i) => {
      if (S.mainPeak < 0 || p.peakIntensity > S.peaks[S.mainPeak].peakIntensity) S.mainPeak = i;
    });
  }
}

/** Re-run detection after the selection or the toggle changed. */
function reanalyze() {
  if (S.frame) analyze();
  const scope = $("detectScope");
  scope.hidden = !S.detect;
  if (S.sel) {
    const d = S.unit === "eV" ? 3 : 2;
    const [a, b] = dispRange(S.sel.lo, S.sel.hi);
    scope.innerHTML = `Searching the selection <b class="mono">${a.toFixed(d)} – ${b.toFixed(d)} ${S.unit}</b>`;
  } else {
    scope.textContent = "Searching the whole spectrum · drag on the plot to narrow it";
  }
  updateSelChip();
  requestRender();
}

function setDetect(on) {
  S.detect = on;
  $("detectChk").checked = on;
  reanalyze();
}

function showFrame(f) {
  const first = !S.frame;
  S.frame = f;
  S.disp = toDisplay(f.wl, f.inten);
  const wasSaturated = S.saturated;
  S.saturated = f.rawMax >= SATURATION;
  if (S.saturated && !wasSaturated) {
    toast("Detector saturated — the highest peak is clipped. Shorten the exposure or turn on Auto.", "bad", 6000, "sat");
  }
  analyze();
  requestRender(first);
}

let renderQueued = false, resetXPending = false;
function requestRender(resetX = false) {
  resetXPending ||= resetX;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function render() {
  renderQueued = false;
  if (S.disp) {
    u.batch(() => {
      u.setData([S.disp.x, S.disp.y], false);
      if (resetXPending) {
        const [a, b] = dataXRange();
        u.setScale("x", { min: a, max: b });
      }
      if ($("autoY").checked) {
        const yr = autoscaleY();
        if (yr) u.setScale("y", { min: yr[0], max: yr[1] });
      }
    });
  } else {
    u.redraw(false, false);
  }
  resetXPending = false;
  updatePeakList();
  $("satBadge").hidden = !S.saturated;
  $("plotEmpty").hidden = !!S.frame;
  $("scanInfo").textContent = S.live ? `${S.scans} scans · ${S.fps.toFixed(1)} Hz` : "";
}

// ---------------------------------------------------------------- device actions
const darkValid = () => S.dark !== null && Math.abs(S.darkIntMs - S.intMs) < 1e-6;
const darkActive = () => S.subtractDark && darkValid();

/** One spectrum: mean of S.avg scans, dark subtracted when valid, then boxcar smoothed. */
async function acquireFrame() {
  const dev = S.dev, n = S.avg;
  const meta = {
    time: new Date(), model: dev.model, serial: dev.serialNumber, intMs: S.intMs, avg: n, boxcar: S.boxcar,
    darkMs: darkActive() ? S.darkIntMs : null,
  };
  let raw = null, rawMax = 0;
  for (let k = 0; k < n; k++) {
    const scan = await dev.intensities();
    for (const v of scan) if (v > rawMax) rawMax = v;
    if (!raw) raw = Float64Array.from(scan);
    else for (let i = 0; i < raw.length; i++) raw[i] += scan[i];
  }
  if (n > 1) for (let i = 0; i < raw.length; i++) raw[i] /= n;
  let inten = meta.darkMs !== null ? Float64Array.from(raw, (v, i) => v - S.dark[i]) : raw;
  inten = boxcar(inten, S.boxcar);
  return { wl: S.wl, raw, inten, rawMax, meta };
}

/** Auto integration: rescale so the highest peak sits near 80 % of full scale. */
async function autoAdjustIntegration(f) {
  const [base, noise] = estimateBaseline(f.raw);
  const signal = f.rawMax - base, full = SATURATION - base;
  if (signal < 20 * noise && f.rawMax < SATURATION) return; // no real signal to scale on
  const frac = signal / full;
  if (f.rawMax < SATURATION && frac >= AUTO_INT_BAND[0] && frac <= AUTO_INT_BAND[1]) return;
  const ratio = f.rawMax >= SATURATION ? 0.5 : clamp(AUTO_INT_TARGET / frac, 0.1, 10);
  let next = clamp(S.intMs * ratio, MIN_INT_MS, MAX_INT_MS);
  next = next >= 100 ? Math.round(next) : Math.round(next * 10) / 10;
  if (Math.abs(next - S.intMs) / S.intMs > 0.02) {
    await applyIntegration(next, true);
    toast(`Auto exposure set to ${S.intMs} ms`, "info", 3000, "exposure");
  }
}

function connectErrorText(e) {
  const msg = e?.message || String(e);
  if (e?.name === "SecurityError" || /access denied|unable to claim|failed to open|in use/i.test(msg)) {
    const win = /Windows/.test(navigator.userAgent);
    return `HDX connection failed: ${msg}. ` + (win
      ? "On Windows the HDX needs the WinUSB driver (install once with Zadig). Also close other programs using it."
      : "Close other programs using the HDX. On Linux a udev rule is needed for USB access.");
  }
  return `HDX connection failed: ${msg}`;
}

async function connect() {
  if (S.dev) return disconnect();
  S.busy = true;
  updateUi();
  try {
    // A single HDX the browser already has permission for opens without the chooser
    const known = (await navigator.usb.getDevices()).filter(HDXUSB.isHDX);
    const dev = known.length === 1 ? await HDXUSB.open(known[0]) : await HDXUSB.request();
    S.wl = await dev.wavelengths();
    await dev.setIntegrationUs(S.intMs * 1000);
    S.dev = dev;
    S.dark = null;
    S.darkIntMs = null;
    toast(`Connected: ${dev.model} S/N ${dev.serialNumber}`, "ok");
  } catch (e) {
    if (!(e?.name === "NotFoundError" && /select/i.test(e.message))) toast(connectErrorText(e), "bad", 10000);
  } finally {
    S.busy = false;
    updateUi();
  }
}

async function disconnect() {
  S.live = false;
  const dev = S.dev;
  S.dev = null;
  updateUi();
  if (dev) {
    await dev.close();
    toast(`Disconnected from ${dev.model}`, "info", 3000);
  }
}

if (HDXUSB.supported()) {
  navigator.usb.addEventListener("disconnect", (e) => {
    if (S.dev instanceof HDXUSB && S.dev.dev === e.device) {
      S.live = false;
      S.dev = null;
      toast("HDX was unplugged.", "bad");
      updateUi();
    }
  });
}

async function acquireOnce() {
  if (!S.dev || S.live || S.busy) return;
  S.busy = true;
  updateUi();
  const scans = S.avg === 1 ? `${S.intMs} ms` : `${S.avg} × ${S.intMs} ms`;
  if (S.avg * S.intMs > 400) toast(`Acquiring ${scans}…`, "info", 60000, "acq");
  try {
    const f = await acquireFrame();
    showFrame(f);
    toast(`Spectrum acquired — ${scans}, max ${f.rawMax.toFixed(0)} counts`, f.rawMax >= SATURATION ? "bad" : "ok", 4000, "acq");
    if (S.autoInt) await autoAdjustIntegration(f);
  } catch (e) {
    toast(`Acquisition failed: ${e.message}`, "bad", 6000, "acq");
  } finally {
    S.busy = false;
    updateUi();
  }
}

async function toggleLive() {
  if (S.live) {
    S.live = false;
    updateUi();
    return;
  }
  if (!S.dev || S.busy) return;
  const dev = S.dev;
  S.live = true;
  S.scans = 0;
  updateUi();
  toast("Live view started", "info", 2500, "live");
  let t = performance.now();
  while (S.live && S.dev === dev) {
    try {
      const f = await acquireFrame();
      if (!S.live) break;
      showFrame(f);
      if (S.autoInt) await autoAdjustIntegration(f);
      S.scans++;
      const now = performance.now();
      S.fps = S.fps ? 0.8 * S.fps + 0.2 * (1000 / (now - t)) : 1000 / (now - t);
      t = now;
    } catch (e) {
      if (S.live && S.dev === dev) toast(`Live view stopped: ${e.message}`, "bad", 6000, "live");
      S.live = false;
      break;
    }
  }
  if (S.dev === dev && !toastsByKey.get("live")?.classList.contains("bad")) {
    toast(`Live view stopped after ${S.scans} scan${S.scans === 1 ? "" : "s"}`, "ok", 3000, "live");
  }
  S.live = false;
  updateUi();
  requestRender();
}

async function applyIntegration(ms, auto = false) {
  if (!Number.isFinite(ms)) ms = S.intMs;
  ms = clamp(Math.round(ms * 1000) / 1000, MIN_INT_MS, MAX_INT_MS);
  const changed = ms !== S.intMs;
  S.intMs = ms;
  $("intInput").value = String(ms);
  S.yRange = null;
  if (S.dev) {
    try {
      await S.dev.setIntegrationUs(ms * 1000);
    } catch (e) {
      toast(`Exposure could not be set: ${e.message}`, "bad", 6000, "exposure");
      updateUi();
      return;
    }
  }
  if (changed && !auto) toast(`Exposure set to ${ms} ms`, "info", 2500, "exposure");
  updateUi();
}

async function takeDark() {
  if (!S.dev || S.live || S.busy) return;
  const ok = await confirmDialog("Background measurement",
    "Block the light (close the shutter or turn the lamp off), then press OK.");
  if (!ok || !S.dev) return;
  const dev = S.dev;
  const n = clamp(Math.round(+$("darkAvg").value) || 10, 1, 500);
  S.busy = true;
  S.measuringDark = true;
  updateUi();
  try {
    const sum = new Float64Array(S.wl.length);
    for (let k = 0; k < n; k++) {
      setDarkStatus(`Measuring ${k + 1} / ${n}…`, "warn", `measuring ${k + 1}/${n}`);
      const raw = await dev.intensities();
      for (let i = 0; i < sum.length; i++) sum[i] += raw[i];
    }
    S.dark = sum.map((v) => v / n);
    S.darkIntMs = S.intMs;
    toast(`Dark stored (${n} × ${S.intMs} ms). Restore the light.`, "ok", 6000);
  } catch (e) {
    toast(`Dark failed: ${e.message}`, "bad");
  } finally {
    S.busy = false;
    S.measuringDark = false;
    updateUi();
  }
}

function setDarkStatus(text, kind, short) {
  const el = $("darkStatus");
  el.textContent = text;
  el.className = `status-line ${kind}`;
  $("darkStage").textContent = short;
  $("darkDot").className = `dot ${kind}`;
}

/** '#' header lines describing how the current spectrum was measured. */
function metaHeader(title, extra = []) {
  const m = S.frame.meta;
  return [
    `# ${title}`,
    `# acquired: ${m.time.toISOString()}`,
    `# device: ${m.model}, serial ${m.serial}`,
    `# integration_ms: ${m.intMs}`,
    `# averages: ${m.avg}`,
    `# boxcar_half_width_px: ${m.boxcar}`,
    `# dark_subtracted: ${m.darkMs !== null ? `yes (dark at ${m.darkMs} ms)` : "no"}`,
    ...extra,
  ];
}

function download(lines, prefix) {
  const stamp = S.frame.meta.time.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = `${prefix}_${stamp}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${a.download}`, "ok", 4000);
}

function exportSpectrum() {
  if (!S.frame) return;
  const { wl, inten } = S.frame;
  const lines = metaHeader("Spektra — HDX spectrum");
  lines.push("wavelength_nm,energy_ev,intensity");
  for (let i = 0; i < wl.length; i++) lines.push(`${wl[i]},${nmToEv(wl[i])},${inten[i]}`);
  download(lines, "spectrum");
}

function exportPeaks() {
  if (!S.frame || !S.peaks.length) return;
  const range = S.sel ? `${S.sel.lo.toFixed(3)}-${S.sel.hi.toFixed(3)} nm` : "whole spectrum";
  const lines = metaHeader("Spektra — HDX detected peaks", [
    `# search_range: ${range}`,
    `# detection: automatic (prominence >= ${AUTO_PEAKS.minSnr} x noise and >= ${AUTO_PEAKS.minProminenceFrac * 100} % of the strongest peak)`,
  ]);
  lines.push("peak,wavelength_nm,energy_ev,fwhm_nm,fwhm_ev,counts,area,snr,strongest");
  S.peaks.forEach((p, i) => lines.push([
    i + 1, p.measuredPeak.toFixed(4), p.energyEv.toFixed(5), fmt(p.fwhmNm, 4), fmt(p.fwhmEv, 5),
    p.rawIntensity.toFixed(0), fmt(p.integratedIntensity, 1), p.snr.toFixed(1), i === S.mainPeak ? "yes" : "",
  ].join(",")));
  download(lines, "peaks");
}

// ---------------------------------------------------------------- UI state
function updateUi() {
  const c = !!S.dev, usb = HDXUSB.supported() && window.isSecureContext;
  $("connectLabel").textContent = c ? "Disconnect" : "Connect HDX";
  $("connectBtn").classList.toggle("primary", !c);
  $("connectBtn").disabled = S.busy || (!c && !usb);
  $("led").className = `led${c ? " on" : ""}${S.live ? " live" : ""}`;
  $("devInfo").textContent = c ? `${S.dev.model} · S/N ${S.dev.serialNumber}` : "Not connected";
  $("acqBtn").disabled = !c || S.live || S.busy;
  $("liveBtn").disabled = !c || S.busy;
  $("liveLabel").textContent = S.live ? "Stop" : "Live";
  $("liveBtn").classList.toggle("stop", S.live);
  $("liveBtn").classList.toggle("primary", !S.live);
  $("darkBtn").disabled = !c || S.live || S.busy;
  $("darkClear").disabled = S.dark === null || S.busy;
  $("csvBtn").disabled = !S.frame;
  for (const id of ["intInput", "intUp", "intDown"]) $(id).disabled = S.autoInt;
  if (!S.measuringDark) {
    if (S.dark === null) setDarkStatus("No dark taken — raw counts are shown.", "warn", "none");
    else if (!darkValid()) setDarkStatus(`Taken at ${S.darkIntMs} ms, exposure is now ${S.intMs} ms — retake it.`, "bad", "retake");
    else if (!S.subtractDark) setDarkStatus(`Valid (${S.darkIntMs} ms) but not subtracted.`, "warn", "off");
    else setDarkStatus(`Subtracting the dark taken at ${S.darkIntMs} ms.`, "ok", "subtracted");
  }
  updateChain();
  if (!S.live) $("scanInfo").textContent = "";
}

/** Values shown on the signal-chain stages. */
function updateChain() {
  $("avgStage").textContent = S.avg === 1 ? "1 scan" : `${S.avg} scans`;
  $("boxcarStage").textContent = S.boxcar ? `±${S.boxcar} px` : "off";
  $("displayStage").textContent = `${S.unit} · ${$("autoY").checked ? "auto Y" : "fixed Y"}`;
  for (const box of document.querySelectorAll(".presets")) {
    const v = $(box.dataset.for).value;
    for (const b of box.children) b.classList.toggle("on", b.textContent === v);
  }
}

/** Popovers open next to the control that opened them (above it when it sits low on the screen). */
for (const pop of document.querySelectorAll("[popover]")) {
  const opener = document.querySelector(`[popovertarget="${pop.id}"]`);
  pop.addEventListener("toggle", (e) => {
    const open = e.newState === "open";
    opener?.setAttribute("aria-expanded", String(open));
    if (!open || !opener) return;
    const r = opener.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${clamp(r.left, 8, innerWidth - w - 8)}px`;
    pop.style.top = `${r.top > innerHeight / 2 ? r.top - h - 8 : r.bottom + 8}px`;
  });
}

for (const box of document.querySelectorAll(".presets")) {
  box.addEventListener("click", (e) => {
    if (e.target.tagName !== "BUTTON") return;
    const input = $(box.dataset.for);
    input.value = e.target.textContent;
    input.dispatchEvent(new Event("change"));
  });
}

// ---------------------------------------------------------------- wiring
$("connectBtn").addEventListener("click", connect);
$("acqBtn").addEventListener("click", acquireOnce);
$("liveBtn").addEventListener("click", toggleLive);
$("csvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportSpectrum(); });
$("peaksCsvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportPeaks(); });
$("autoInt").addEventListener("change", (e) => { S.autoInt = e.target.checked; updateUi(); });
$("avgInput").addEventListener("change", (e) => {
  S.avg = clamp(Math.round(+e.target.value) || 1, 1, 1000);
  e.target.value = S.avg;
  updateChain();
  toast(S.avg === 1 ? "Averaging off — every scan is shown" : `Averaging ${S.avg} scans per spectrum`, "info", 2500, "avg");
});
$("boxcarInput").addEventListener("change", (e) => {
  S.boxcar = clamp(Math.round(+e.target.value) || 0, 0, 50);
  e.target.value = S.boxcar;
  updateChain();
  toast(S.boxcar ? `Boxcar smoothing ±${S.boxcar} px` : "Boxcar smoothing off", "info", 2500, "boxcar");
});
$("resetView").addEventListener("click", resetView);
$("darkBtn").addEventListener("click", () => { $("darkPop").hidePopover(); takeDark(); });
$("darkClear").addEventListener("click", () => {
  S.dark = null;
  S.darkIntMs = null;
  updateUi();
  toast("Dark cleared — raw counts are shown", "info", 3000);
});
$("subDark").addEventListener("change", (e) => { S.subtractDark = e.target.checked; updateUi(); });
$("autoY").addEventListener("change", () => { S.yRange = null; updateChain(); requestRender(); });
$("detectChk").addEventListener("change", (e) => setDetect(e.target.checked));
$("selClear").addEventListener("click", clearSelection);

$("intInput").addEventListener("change", (e) => applyIntegration(parseFloat(e.target.value.replace(",", "."))));
$("intInput").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("intUp").addEventListener("click", () => applyIntegration(INT_STEPS.find((v) => v > S.intMs) ?? MAX_INT_MS));
$("intDown").addEventListener("click", () => applyIntegration([...INT_STEPS].reverse().find((v) => v < S.intMs) ?? MIN_INT_MS));

$("unitSeg").addEventListener("click", (e) => {
  const unit = e.target.dataset?.unit;
  if (!unit || unit === S.unit) return;
  S.unit = unit;
  document.querySelectorAll("#unitSeg button").forEach((b) => b.classList.toggle("on", b.dataset.unit === unit));
  if (S.frame) S.disp = toDisplay(S.frame.wl, S.frame.inten);
  createPlot(false);
  updateChain();
  reanalyze();
  requestRender(!!S.frame);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest("input, dialog")) clearSelection();
});

window.addEventListener("beforeunload", () => { if (S.dev) S.dev.close(); });

// ---------------------------------------------------------------- environment check
const STORE_ENV = "hdx.envNotice.v1";

function detectPlatform() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iOS"
      : /Macintosh|Mac OS X/.test(ua) ? "macOS"
        : /Android/.test(ua) ? "Android"
          : /CrOS/.test(ua) ? "ChromeOS"
            : /Linux|X11/.test(ua) ? "Linux" : "an unknown system";
  const browser = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\//.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Google Chrome"
      : /Safari\//.test(ua) ? "Safari" : "This browser";
  return { os, browser };
}

/** What this computer and browser still need before the HDX can be used. */
function environmentNotes({ os, browser }) {
  const notes = [];
  if (os === "iOS" || os === "Android") {
    notes.push({
      level: "block", title: "Use a desktop or laptop computer",
      html: `<p>The HDX connects over USB to a computer. ${os} browsers cannot open USB devices from a web page.</p>`,
    });
  } else if (!HDXUSB.supported()) {
    notes.push({
      level: "block", title: `${browser} cannot open USB devices`,
      html: "<p>This page talks to the spectrometer through WebUSB, which only Chromium-based browsers provide. "
        + "Open it in <b>Google Chrome</b> or <b>Microsoft Edge</b>.</p>",
    });
  }
  if (!window.isSecureContext) {
    notes.push({
      level: "block", title: "Open the page over HTTPS",
      html: "<p>WebUSB works only on <code>https://</code> pages or on <code>http://localhost</code>. "
        + "Use the published HTTPS address, or serve the folder locally.</p>",
    });
  }
  if (os === "Windows") {
    notes.push({
      level: "setup", title: "Windows: install the WinUSB driver once",
      html: "<ol><li>Plug in the HDX and run <a href=\"https://zadig.akeo.ie\" target=\"_blank\" rel=\"noopener\">Zadig</a> (no installation needed).</li>"
        + "<li>Choose <i>Options → List All Devices</i> and select the HDX (USB ID <code>2457</code> <code>2003</code>).</li>"
        + "<li>Select <b>WinUSB</b> as the driver and press <i>Replace Driver</i> or <i>Install Driver</i>.</li></ol>"
        + "<p>Needed once per computer. Afterwards OceanView no longer sees the HDX until its driver is restored in Device Manager.</p>",
    });
  }
  if (os === "Linux") {
    notes.push({
      level: "setup", title: "Linux: allow USB access once",
      html: "<p>Create <code>/etc/udev/rules.d/99-ocean-hdx.rules</code> with:</p>"
        + "<pre>SUBSYSTEM==\"usb\", ATTR{idVendor}==\"2457\", ATTR{idProduct}==\"2003\", MODE=\"0666\"</pre>"
        + "<p>then run <code>sudo udevadm control --reload-rules &amp;&amp; sudo udevadm trigger</code> and replug the HDX.</p>",
    });
  }
  return notes;
}

/** On start: explain what is missing; `force` also opens it when everything is ready (from the help). */
function checkEnvironment(force = false) {
  const env = detectPlatform();
  const notes = environmentNotes(env);
  const blocking = notes.some((n) => n.level === "block");
  if (!force && (!notes.length || (!blocking && store.get(STORE_ENV) === "1"))) return;
  $("envSystem").textContent = `${env.browser} on ${env.os}`;
  $("envList").innerHTML = notes.length
    ? notes.map((n) => `<li class="env-${n.level}"><h4>${n.title}</h4>${n.html}</li>`).join("")
    : "<li class=\"env-ready\"><h4>Ready</h4><p>This browser supports WebUSB and this system needs no driver. Plug in the HDX and press Connect.</p></li>";
  $("envTitle").textContent = blocking ? "This browser cannot connect to the HDX" : notes.length ? "Before you connect" : "System check";
  $("envHideRow").hidden = blocking || !notes.length;
  $("envDlg").showModal();
}

$("envDlg").addEventListener("close", () => {
  if ($("envHide").checked) store.set(STORE_ENV, "1");
});
$("envOpen").addEventListener("click", () => { $("helpPop").hidePopover(); checkEnvironment(true); });

createPlot(false);
updateUi();
reanalyze();
checkEnvironment();
