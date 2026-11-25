// Spektra, browser software for the Ocean Insight HDX: live uPlot spectrum, nm/eV axis, range selection and peak detection.
// Entry point: connects the page controls to the modules and starts the app.

import { acquireOnce, applyIntegration, clearDark, connect, takeDark, toggleLive, watchDevice } from "./acquisition.js";
import { INT_STEPS } from "./config.js";
import { exportPeaks, exportPlotPng, exportSpectrum } from "./export.js";
import { clearSelection, reanalyze, requestRender, setDetect, setJacobian, setLogY, setSelection, setUnit, toggleReference } from "./spectrum.js";
import { S } from "./state.js";
import { initCalibration } from "./ui/calibration.js";
import { initPopovers, parseExposure, showExposure, showGuide, updateChain, updateUi } from "./ui/controls.js";
import { initHints } from "./ui/hints.js";
import { initPeakTable, markRows, peakTableText } from "./ui/peaks.js";
import { initRail, setRailCollapsed } from "./ui/rail.js";
import { initMobile, isCompact } from "./ui/mobile.js";
import { initDiag } from "./ui/diag.js";
import { checkEnvironment, initEnvironment } from "./ui/environment.js";
import { toast } from "./ui/notify.js";
import { initPlot, redrawPlot, resetView, zoomToPeak, zoomToSelection } from "./ui/plot.js";
import { $, clamp, store } from "./util.js";

store.remove("hdx.rois.v1"); // saved regions of an earlier version
store.remove("hdx.theme"); // the light theme was removed

/** One peak highlighted at a time, from the table or the plot. */
function setHoverPeak(i) {
  if (i === S.hoverPeak) return;
  S.hoverPeak = i;
  markRows();
  redrawPlot();
}

initPlot({ setSelection, clearSelection, reanalyze, hoverPeak: setHoverPeak });
initRail();
initMobile(() => setRailCollapsed(true)); // phones start with the peaks drawer closed
initPopovers();
initDiag(); // ?diag only
initCalibration();
initHints();
initPeakTable({
  onHover: setHoverPeak,
  // Click a row to zoom to its peak; click it again to go back to the whole spectrum
  onClick: (i) => {
    if (S.focusPeak === i) {
      resetView();
    } else {
      S.focusPeak = i;
      zoomToPeak(S.peaks[i]);
      markRows();
      if (isCompact()) setRailCollapsed(true); // the drawer covers the plot: close it to show the peak
    }
    redrawPlot();
  },
});
$("peaksCopy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(peakTableText());
    toast(`Copied ${S.peaks.length} peak${S.peaks.length === 1 ? "" : "s"} — paste into a spreadsheet`, "ok", 3000, "copy");
  } catch {
    toast("The table could not be copied — the browser blocked the clipboard", "bad", 5000, "copy");
  }
});
$("detectScope").addEventListener("click", (e) => { if (e.target.closest('[data-act="clear-sel"]')) clearSelection(); });
initEnvironment();
watchDevice();

// ---------------------------------------------------------------- top bar
$("connectBtn").addEventListener("click", connect);
$("disconnectBtn").addEventListener("click", connect); // connect() disconnects when connected
$("acqBtn").addEventListener("click", acquireOnce);
$("liveBtn").addEventListener("click", toggleLive);
$("csvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportSpectrum(); });

$("peaksCsvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportPeaks(); });

// ---------------------------------------------------------------- exposure control
const stepExposure = (dir) => applyIntegration(dir > 0
  ? INT_STEPS.find((v) => v > S.intMs) ?? S.intLimitsMs[1]
  : [...INT_STEPS].reverse().find((v) => v < S.intMs) ?? S.intLimitsMs[0]);

const intInput = $("intInput");
intInput.addEventListener("change", () => {
  const ms = parseExposure(intInput.value);
  if (Number.isFinite(ms) && ms !== S.intMs) applyIntegration(ms);
  else showExposure(true);
});
intInput.addEventListener("focus", () => intInput.select());
intInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") intInput.blur();
  else if (e.key === "Escape") { showExposure(true); intInput.blur(); }
  else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); stepExposure(e.key === "ArrowUp" ? 1 : -1); }
});
// Scroll over the control steps the exposure; trackpads send many small deltas, so accumulate them
let wheelAcc = 0;
$("expoBox").addEventListener("wheel", (e) => {
  e.preventDefault();
  if (S.autoInt) return; // Auto owns the exposure
  wheelAcc += e.deltaY;
  if (Math.abs(wheelAcc) < 40) return;
  stepExposure(wheelAcc < 0 ? 1 : -1);
  wheelAcc = 0;
}, { passive: false });
$("intUp").addEventListener("click", () => stepExposure(1));
$("intDown").addEventListener("click", () => stepExposure(-1));
$("autoInt").addEventListener("change", (e) => {
  S.autoInt = e.target.checked;
  updateUi();
  toast(S.autoInt ? "Auto exposure on — the exposure follows the signal" : "Auto exposure off — set it by hand", "info", 3000, "auto");
});

// First-run guide on the empty plot: each step's button runs that step
$("guideSteps").addEventListener("click", (e) => {
  const act = e.target.closest("button")?.dataset.act;
  if (act === "connect") connect();
  else if (act === "dark") takeDark();
  else if (act === "live") toggleLive();
});

$("guideClose").addEventListener("click", () => showGuide(false));
$("guideOpen").addEventListener("click", () => { $("helpPop").hidePopover(); showGuide(true); });

// ---------------------------------------------------------------- plot and peaks
$("resetView").addEventListener("click", resetView);
$("selClear").addEventListener("click", clearSelection);
$("selZoom").addEventListener("click", zoomToSelection);
$("holdBtn").addEventListener("click", toggleReference);
$("logY").addEventListener("change", (e) => setLogY(e.target.checked));
$("pngBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportPlotPng(); });
$("detectChk").addEventListener("change", (e) => setDetect(e.target.checked));
// Keyboard: Esc clears the selection; single keys for the frequent actions (not while typing)
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") clearSelection();
  else if (e.key === " " && !e.target.closest?.("button, label, a")) { e.preventDefault(); if (S.dev) toggleLive(); }
  else if (e.key === "a" || e.key === "A") acquireOnce();
  else if (e.key === "r" || e.key === "R") resetView();
  else if (e.key === "h" || e.key === "H") toggleReference();
  else if (e.key === "l" || e.key === "L") $("logY").click();
});

// ---------------------------------------------------------------- signal chain
$("avgInput").addEventListener("change", (e) => {
  S.avg = clamp(Math.round(+e.target.value) || 1, 1, 1000);
  e.target.value = S.avg;
  updateChain();
  toast(S.avg === 1 ? "Averaging off — every scan is shown" : `Averaging ${S.avg} scans per spectrum`, "info", 2500, "avg");
});
$("darkBtn").addEventListener("click", () => { $("darkPop").hidePopover(); takeDark(); });
$("darkClear").addEventListener("click", clearDark);
$("subDark").addEventListener("change", (e) => { S.subtractDark = e.target.checked; updateUi(); });
$("boxcarInput").addEventListener("change", (e) => {
  S.boxcar = clamp(Math.round(+e.target.value) || 0, 0, 50);
  e.target.value = S.boxcar;
  updateChain();
  toast(S.boxcar ? `Boxcar smoothing ±${S.boxcar} px` : "Boxcar smoothing off", "info", 2500, "boxcar");
});
$("unitSeg").addEventListener("click", (e) => {
  const unit = e.target.dataset?.unit;
  if (!unit || unit === S.unit) return;
  document.querySelectorAll("#unitSeg button").forEach((b) => b.classList.toggle("on", b.dataset.unit === unit));
  setUnit(unit);
  updateChain();
});
$("jacobianChk").addEventListener("change", (e) => {
  setJacobian(e.target.checked);
  updateChain();
  toast(e.target.checked ? "Jacobian on — intensity in counts per meV" : "Jacobian off — counts per pixel on the eV axis", "info", 3000, "jacobian");
});
$("autoY").addEventListener("change", () => { S.yRange = null; updateChain(); requestRender(); });

updateUi();
reanalyze();
checkEnvironment();
