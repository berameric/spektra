// CSV export of the current spectrum and of the detected peaks, with acquisition metadata.

import { nmToEv } from "./analysis/peaks.js";
import { AUTO_PEAKS } from "./config.js";
import { S } from "./state.js";
import { toast } from "./ui/notify.js";
import { fmt } from "./util.js";

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

export function exportSpectrum() {
  if (!S.frame) return;
  const { wl, inten } = S.frame;
  const lines = metaHeader("Spektra — HDX spectrum");
  lines.push("wavelength_nm,energy_ev,intensity");
  for (let i = 0; i < wl.length; i++) lines.push(`${wl[i]},${nmToEv(wl[i])},${inten[i]}`);
  download(lines, "spectrum");
}

export function exportPeaks() {
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
