// From acquired frame to screen: display unit, peak detection within the selection, and render scheduling.

import { energySpectrum, findEnergyPeaks, findSpectralPeaks, nmToEv } from "./analysis/peaks.js";
import { AUTO_PEAKS } from "./config.js";
import { S, perMev, satLevel } from "./state.js";
import { updateMeter } from "./ui/controls.js";
import { dismissHint, updateHint } from "./ui/hints.js";
import { toast } from "./ui/notify.js";
import { updatePeakList, updateScope } from "./ui/peaks.js";
import { createPlot, plotData, redrawPlot } from "./ui/plot.js";
import { $ } from "./util.js";

function toDisplay(wl, inten) {
  if (S.unit === "nm") return { x: wl, y: inten };
  if (S.jacobian) return energySpectrum(wl, inten);
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
    const find = perMev() ? findEnergyPeaks : findSpectralPeaks;
    S.peaks = find(f.wl, f.inten, { ...AUTO_PEAKS, ...range })
      .sort((a, b) => a.measuredPeak - b.measuredPeak);
    S.peaks.forEach((p, i) => {
      if (S.mainPeak < 0 || p.peakIntensity > S.peaks[S.mainPeak].peakIntensity) S.mainPeak = i;
    });
  }
  // Highlights refer to peaks by number; drop them when that peak no longer exists
  if (S.hoverPeak >= S.peaks.length) S.hoverPeak = -1;
  if (S.focusPeak >= S.peaks.length) S.focusPeak = -1;
}

/** Re-run detection after the selection or the toggle changed. */
export function reanalyze() {
  if (S.frame) analyze();
  updateScope();
  requestRender();
}

export function setSelection(a, b) {
  S.sel = { lo: Math.min(a, b), hi: Math.max(a, b) };
  dismissHint(); // the gesture has been found
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
  redisplay(false);
}

export function setJacobian(on) {
  S.jacobian = on;
  if (S.unit === "eV") redisplay(true);
}

export function setLogY(on) {
  S.logY = on;
  S.yRange = null;
  createPlot(true, false);
  requestRender();
}

/** Hold the current spectrum as a reference curve (or drop the held one). */
export function toggleReference() {
  if (S.ref) {
    S.ref = S.refDisp = null;
    toast("Reference cleared", "info", 2500, "ref");
  } else if (S.frame) {
    S.ref = { wl: S.frame.wl, inten: Float64Array.from(S.frame.inten), time: new Date() };
    S.refDisp = toDisplay(S.ref.wl, S.ref.inten);
    toast("Reference held — the live spectrum is drawn over it", "ok", 3000, "ref");
  }
  $("holdBtn").classList.toggle("on", !!S.ref);
  $("holdLabel").textContent = S.ref ? "Reference" : "Hold";
  requestRender();
}

/** Recompute the displayed spectrum and its peaks after the axis or its intensity unit changed. */
function redisplay(keepX) {
  S.yRange = null;
  if (S.frame) S.disp = toDisplay(S.frame.wl, S.frame.inten);
  if (S.ref) S.refDisp = toDisplay(S.ref.wl, S.ref.inten);
  createPlot(keepX, false); // the intensity unit may have changed
  reanalyze();
  requestRender(!keepX && !!S.frame);
}

/** Show a newly acquired frame. */
export function showFrame(f) {
  const first = !S.frame;
  S.frame = f;
  S.disp = toDisplay(f.wl, f.inten);
  const wasSaturated = S.saturated;
  S.saturated = f.rawMax >= satLevel();
  if (S.saturated && !wasSaturated) {
    toast("Detector saturated — the highest peak is clipped. Shorten the exposure or turn on Auto.", "bad", 6000, "sat");
  } else if (wasSaturated && !S.saturated) {
    toast("Signal back in range — no longer saturated", "ok", 3000, "sat");
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
  updateMeter();
  updateHint();
  $("satBadge").hidden = !S.saturated;
  $("csvBtn").disabled = $("pngBtn").disabled = !S.frame;
  $("holdBtn").disabled = !S.frame && !S.ref;
  $("plotEmpty").hidden = !!S.frame;
  $("scanInfo").textContent = S.live ? `${S.scans} scans · ${S.fps.toFixed(1)} Hz` : "";
}
