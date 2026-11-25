// CSV export of the current spectrum and of the detected peaks, with acquisition metadata.

import { energySpectrum, nmToEv } from "./analysis/peaks.js";
import { AUTO_PEAKS } from "./config.js";
import { S, perMev } from "./state.js";
import { calText } from "./ui/calibration.js";
import { toast } from "./ui/notify.js";
import { plotCanvas } from "./ui/plot.js";
import { cssVar, fmt } from "./util.js";

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
    ...calibrationHeader(m.cal),
    ...extra,
  ];
}

/** How the wavelength axis was calibrated: the instrument's own, or with Spektra's correction on top of it. */
function calibrationHeader(cal) {
  if (!cal) return ["# wavelength_calibration: factory (stored in the instrument)"];
  return [
    `# wavelength_calibration: ${calText(cal)}`,
    `# wavelength_correction: lambda = lambda_factory + sum(c_k * u^k), u = (lambda_factory - 600 nm) / 400 nm, c_k [nm] = ${cal.coeffs.map((c) => c.toExponential(6)).join(", ")}`,
  ];
}

const stamp = () => S.frame.meta.time.toISOString().replace(/[:.]/g, "-").slice(0, 19);

function saveBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${name}`, "ok", 4000);
}

function download(lines, prefix) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = `${prefix}_${stamp()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Saved ${a.download}`, "ok", 4000);
}

export function exportSpectrum() {
  if (!S.frame) return;
  const { wl, inten } = S.frame;
  const { offset, factor } = energySpectrum(wl, inten);
  const lines = metaHeader("Spektra — HDX spectrum", [
    "# intensity: counts per pixel",
    `# intensity_per_mev: Jacobian conversion (intensity - ${offset.toFixed(1)} offset) / pixel width in meV, i.e. I(lambda)*lambda^2/hc`,
  ]);
  lines.push("wavelength_nm,energy_ev,intensity,intensity_per_mev");
  for (let i = 0; i < wl.length; i++) {
    lines.push(`${wl[i]},${nmToEv(wl[i])},${inten[i]},${Number.isFinite(factor[i]) ? (inten[i] - offset) * factor[i] : ""}`);
  }
  download(lines, "spectrum");
}

/** The plot as shown, on the page background, with a line saying how it was measured. */
export function exportPlotPng() {
  if (!S.frame) return;
  const src = plotCanvas(), pr = window.devicePixelRatio || 1, foot = Math.round(26 * pr);
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height + foot;
  const ctx = out.getContext("2d");
  ctx.fillStyle = cssVar("--panel");
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);
  const m = S.frame.meta;
  ctx.fillStyle = cssVar("--muted");
  ctx.font = `${11 * pr}px ${cssVar("--font")}`;
  ctx.textBaseline = "middle";
  ctx.fillText(`Spektra · ${m.model} S/N ${m.serial} · ${m.intMs} ms × ${m.avg} · ${m.darkMs !== null ? "dark subtracted" : "no dark"}${m.cal ? " · λ calibrated" : ""} · ${m.time.toISOString().slice(0, 19).replace("T", " ")} UTC`,
    12 * pr, src.height + foot / 2);
  out.toBlob((blob) => saveBlob(blob, `plot_${stamp()}.png`), "image/png");
}

export function exportPeaks() {
  if (!S.frame || !S.peaks.length) return;
  const range = S.sel ? `${S.sel.lo.toFixed(3)}-${S.sel.hi.toFixed(3)} nm` : "whole spectrum";
  const lines = metaHeader("Spektra — HDX detected peaks", [
    `# search_range: ${range}`,
    perMev()
      ? "# measured_on: energy axis, Jacobian-converted (height in counts/meV, area in counts)"
      : "# measured_on: wavelength axis (height in counts per pixel)",
    `# detection: automatic (prominence >= ${AUTO_PEAKS.minSnr} x noise and >= ${AUTO_PEAKS.minProminenceFrac * 100} % of the strongest peak)`,
  ]);
  lines.push("peak,wavelength_nm,energy_ev,fwhm_nm,fwhm_ev,height,area,snr,strongest");
  S.peaks.forEach((p, i) => lines.push([
    i + 1, p.measuredPeak.toFixed(4), p.energyEv.toFixed(5), fmt(p.fwhmNm, 4), fmt(p.fwhmEv, 5),
    p.rawIntensity.toFixed(0), fmt(p.integratedIntensity, 1), p.snr.toFixed(1), i === S.mainPeak ? "yes" : "",
  ].join(",")));
  download(lines, "peaks");
}
