// Wavelength calibration: the Wavelength stage of the processing bar, its dialog (light source, matched lines,
// fit) and the corrections kept per instrument. Nothing is written to the instrument: its factory calibration
// stays as it is and the correction is applied in Spektra.

import { LASERS, LINE_SETS, applyCalibration, correctionAt, fitCalibration, matchLines, rejectOutliers } from "../analysis/calibration.js";
import { findSpectralPeaks } from "../analysis/peaks.js";
import { STORE_CAL } from "../config.js";
import { setWavelengths } from "../spectrum.js";
import { S, satLevel } from "../state.js";
import { $, store } from "../util.js";
import { toast } from "./notify.js";

// Calibration needs every usable line, also weak ones next to strong ones
const CAL_PEAKS = { maxPeaks: 120, minSnr: 5, minProminenceFrac: 0.002, minDistanceNm: 0.8 };
const WEAK_SNR = 15;
const KIND = ["offset", "linear", "quadratic"];

let rows = []; // matched lines: { reference, measured, snr, saturated, outlier, use }

const pm = (nm) => {
  const v = Math.round(nm * 1000);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)}`;
};
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** One line on a calibration: source, number of lines, error and date. */
export function calText(cal) {
  const err = Number.isFinite(cal.rms) ? `RMS ${(cal.rms * 1000).toFixed(0)} pm` : "exact fit";
  return `${cal.source}, ${cal.lines.length} line${cal.lines.length === 1 ? "" : "s"}, ${KIND[cal.degree]}, ${err}, ${fmtDate(cal.date)}`;
}

// ---------------------------------------------------------------- stored corrections, one per instrument

const keyOf = (dev) => `${dev.model.replace(/ \(experimental\)$/, "")}:${dev.serialNumber}`;
function readStore() {
  try { return JSON.parse(store.get(STORE_CAL)) ?? {}; } catch { return {}; }
}

/** The correction saved for this instrument, or null. */
export function storedCalibration(dev) {
  return readStore()[keyOf(dev)] ?? null;
}

function saveCalibration(cal) {
  const all = readStore();
  if (cal) all[keyOf(S.dev)] = cal;
  else delete all[keyOf(S.dev)];
  store.set(STORE_CAL, JSON.stringify(all));
}

// ---------------------------------------------------------------- the stage and its popover

/** Show the calibration in use on the Wavelength stage and in its popover. */
export function updateCalibration() {
  const cal = S.cal;
  $("calStage").textContent = cal ? (Number.isFinite(cal.rms) ? `±${(cal.rms * 1000).toFixed(0)} pm` : "calibrated") : "factory";
  $("calShort").textContent = cal ? "cal." : "fact.";
  $("calDot").className = `dot${cal ? " ok" : ""}`;
  $("calUse").textContent = cal ? "corrected" : "factory";
  $("calInfo").textContent = cal
    ? `${calText(cal)}\nshift ${[400, 550, 700].map((x) => `${pm(correctionAt(cal, x))} pm at ${x} nm`).join(" · ")}`
    : "";
  $("calReset").disabled = !cal || !S.dev;
  $("calOpen").disabled = !S.dev || !S.frame;
  $("calHint").textContent = !S.dev
    ? "Connect the instrument first."
    : !S.frame ? "Take a spectrum of the lamp first (Live or Acquire)." : "";
}

function useCalibration(cal) {
  S.cal = cal;
  saveCalibration(cal);
  setWavelengths(applyCalibration(S.factoryWl, cal));
  updateCalibration();
}

// ---------------------------------------------------------------- the dialog

function referenceLines() {
  const src = $("calSource").value;
  if (src === "laser") return [+$("calLaser").value];
  if (src === "custom") {
    return ($("calCustom").value.match(/\d+(?:[.,]\d+)?/g) ?? []).map((v) => parseFloat(v.replace(",", "."))).filter((v) => v > 150 && v < 1200);
  }
  return LINE_SETS[src].lines;
}

function sourceName() {
  const src = $("calSource").value;
  if (src === "laser") return `${$("calLaser").selectedOptions[0].textContent} laser`;
  if (src === "custom") return "Own lines";
  return LINE_SETS[src].name;
}

/** Detect the peaks of the spectrum on screen (on the factory axis) and pair them with the source's lines. */
function findLines() {
  rows = [];
  const lines = referenceLines(), src = $("calSource").value;
  $("calNote").textContent = LINE_SETS[src]?.note ?? (src === "laser"
    ? "The strongest peak near the laser line is used: one line corrects an offset only."
    : "Lines are matched to the nearest peaks; give at least two for a scale correction.");
  if (S.frame && lines.length) {
    const wl = S.factoryWl;
    const peaks = findSpectralPeaks(wl, S.frame.inten, CAL_PEAKS).map((p) => ({
      nm: p.measuredPeak, height: p.peakIntensity, snr: p.snr, saturated: S.frame.raw[p.index] >= satLevel(),
    }));
    const single = lines.length === 1;
    const matched = matchLines(peaks, lines, { maxShiftNm: single ? 10 : 5, axis: [wl[0], wl[wl.length - 1]] });
    const kept = rejectOutliers(matched.filter((p) => !p.peak.saturated));
    rows = matched.map((p) => ({
      reference: p.reference, measured: p.measured, snr: p.peak.snr, saturated: p.peak.saturated, use: kept.includes(p),
      outlier: !p.peak.saturated && !kept.includes(p),
    }));
  }
  render();
}

function render() {
  const used = rows.filter((r) => r.use);
  const fit = fitCalibration(used);
  const body = $("calRows");
  body.replaceChildren(...rows.map((r, i) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("off", !r.use);
    const err = fit ? r.reference - (r.measured + correctionAt(fit, r.measured)) : NaN;
    // Why a line is doubtful: a clipped top, little signal, or far from the others (often two lines blended)
    const flag = r.saturated ? "saturated" : r.outlier ? "off the fit" : r.snr < WEAK_SNR ? "weak" : "";
    tr.innerHTML = `<td><input type="checkbox" data-i="${i}" ${r.use ? "checked" : ""} aria-label="Use this line"></td>
      <td><input type="text" data-i="${i}" value="${r.reference.toFixed(3)}" aria-label="Line wavelength in nm"></td>
      <td class="mono">${r.measured.toFixed(3)}</td>
      <td class="mono">${Number.isFinite(err) ? pm(err) : "—"}</td>
      <td class="flag">${flag}</td>`;
    return tr;
  }));
  if (!S.frame) {
    $("calSum").textContent = "No spectrum on screen: start Live or press Acquire with the lamp on.";
  } else if (!rows.length) {
    $("calSum").textContent = "No lines of this source found. Check the source, and that its lines are not saturated.";
  } else if (!fit) {
    $("calSum").textContent = "Tick at least one line.";
  } else {
    const err = Number.isFinite(fit.rms) ? `RMS ${(fit.rms * 1000).toFixed(0)} pm` : "exact fit, no spare line to judge the error";
    $("calSum").textContent = `${used.length} line${used.length === 1 ? "" : "s"} · ${KIND[fit.degree]} correction · ${err}` +
      ` · shift ${[400, 550, 700].map((x) => `${pm(correctionAt(fit, x))} pm at ${x} nm`).join(", ")}`;
  }
  $("calApply").disabled = !fit;
}

function apply() {
  const used = rows.filter((r) => r.use);
  const fit = fitCalibration(used);
  if (!fit) return;
  useCalibration({
    source: sourceName(), date: new Date().toISOString(), coeffs: fit.coeffs, degree: fit.degree, rms: fit.rms,
    lines: used.map((r) => ({ reference: r.reference, measured: r.measured })),
  });
  $("calDlg").close();
  toast(`Wavelength calibration applied: ${calText(S.cal)}`, "ok", 6000, "cal");
}

export function initCalibration() {
  $("calLaser").replaceChildren(...LASERS.map((l) => new Option(`${l.name}, ${l.nm} nm`, l.nm)));
  $("calSource").addEventListener("change", () => {
    const src = $("calSource").value;
    $("calLaser").hidden = src !== "laser";
    $("calCustom").hidden = src !== "custom";
    if (src === "custom") $("calCustom").focus();
    findLines();
  });
  $("calLaser").addEventListener("change", findLines);
  $("calCustom").addEventListener("change", findLines);
  $("calFind").addEventListener("click", findLines);
  $("calRows").addEventListener("change", (e) => {
    const r = rows[+e.target.dataset.i];
    if (!r) return;
    if (e.target.type === "checkbox") r.use = e.target.checked;
    else {
      const v = parseFloat(e.target.value.replace(",", "."));
      if (Number.isFinite(v)) r.reference = v;
    }
    render();
  });
  $("calOpen").addEventListener("click", () => {
    $("calPop").hidePopover();
    $("calDlg").showModal();
    findLines();
  });
  $("calReset").addEventListener("click", () => {
    useCalibration(null);
    toast("Factory wavelength calibration in use", "info", 3000, "cal");
  });
  $("calCancel").addEventListener("click", () => $("calDlg").close());
  $("calApply").addEventListener("click", apply);
  $("calPop").addEventListener("toggle", (e) => { if (e.newState === "open") updateCalibration(); });
  updateCalibration();
}
