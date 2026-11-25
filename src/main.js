// Spektra, browser software for the Ocean Insight HDX: live uPlot spectrum, nm/eV axis, range selection and peak detection.
// Entry point: connects the page controls to the modules and starts the app.

import { acquireOnce, applyIntegration, clearDark, connect, takeDark, toggleLive, watchDevice } from "./acquisition.js";
import { INT_STEPS, MAX_INT_MS, MIN_INT_MS } from "./config.js";
import { exportPeaks, exportSpectrum } from "./export.js";
import { clearSelection, reanalyze, requestRender, setDetect, setJacobian, setSelection, setUnit } from "./spectrum.js";
import { S } from "./state.js";
import { initPopovers, updateChain, updateUi } from "./ui/controls.js";
import { checkEnvironment, initEnvironment } from "./ui/environment.js";
import { toast } from "./ui/notify.js";
import { createPlot, initPlot, resetView } from "./ui/plot.js";
import { initTheme } from "./ui/theme.js";
import { $, clamp, store } from "./util.js";

store.remove("hdx.rois.v1"); // saved regions of an earlier version

initTheme(() => createPlot(true));
initPlot({ setSelection, clearSelection, reanalyze });
initPopovers();
initEnvironment();
watchDevice();

// ---------------------------------------------------------------- top bar
$("connectBtn").addEventListener("click", connect);
$("acqBtn").addEventListener("click", acquireOnce);
$("liveBtn").addEventListener("click", toggleLive);
$("csvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportSpectrum(); });
$("peaksCsvBtn").addEventListener("click", () => { $("exportPop").hidePopover(); exportPeaks(); });

$("intInput").addEventListener("change", (e) => applyIntegration(parseFloat(e.target.value.replace(",", "."))));
$("intInput").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("intUp").addEventListener("click", () => applyIntegration(INT_STEPS.find((v) => v > S.intMs) ?? MAX_INT_MS));
$("intDown").addEventListener("click", () => applyIntegration([...INT_STEPS].reverse().find((v) => v < S.intMs) ?? MIN_INT_MS));
$("autoInt").addEventListener("change", (e) => { S.autoInt = e.target.checked; updateUi(); });

// ---------------------------------------------------------------- plot and peaks
$("resetView").addEventListener("click", resetView);
$("selClear").addEventListener("click", clearSelection);
$("detectChk").addEventListener("change", (e) => setDetect(e.target.checked));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.target.closest("input, dialog")) clearSelection();
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
