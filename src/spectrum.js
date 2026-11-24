// From acquired frame to screen: display unit, peak detection within the selection, and render scheduling.

import { findSpectralPeaks, nmToEv } from "./analysis/peaks.js";
import { AUTO_PEAKS, SATURATION } from "./config.js";
import { S } from "./state.js";
import { toast } from "./ui/notify.js";
import { updatePeakList, updateScope } from "./ui/peaks.js";
import { createPlot, plotData, redrawPlot } from "./ui/plot.js";
import { $ } from "./util.js";

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
export function reanalyze() {
  if (S.frame) analyze();
  updateScope();
  requestRender();
}

export function setSelection(a, b) {
  S.sel = { lo: Math.min(a, b), hi: Math.max(a, b) };
  reanalyze();
}

export function clearSelection() {
  if (!S.sel) return;
  S.sel = null;
  reanalyze();
}

export function setDetect(on) {
  S.detect = on;
  $("detectChk").checked = on;
  reanalyze();
}

export function setUnit(unit) {
  S.unit = unit;
  if (S.frame) S.disp = toDisplay(S.frame.wl, S.frame.inten);
  createPlot(false);
  reanalyze();
  requestRender(!!S.frame);
}

/** Show a newly acquired frame. */
export function showFrame(f) {
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

// At most one render per animation frame, however fast spectra arrive
let renderQueued = false, resetXPending = false;
export function requestRender(resetX = false) {
  resetXPending ||= resetX;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(render);
}

function render() {
  renderQueued = false;
  if (S.disp) plotData(resetXPending, $("autoY").checked);
  else redrawPlot();
  resetXPending = false;
  updatePeakList();
  $("satBadge").hidden = !S.saturated;
  $("plotEmpty").hidden = !!S.frame;
  $("scanInfo").textContent = S.live ? `${S.scans} scans · ${S.fps.toFixed(1)} Hz` : "";
}
