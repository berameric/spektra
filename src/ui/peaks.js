// Peaks panel: sortable table of detected peaks (colour-coded like their dots on the plot), search scope,
// copy-to-spreadsheet and the selection chip above the plot. Rows and plot dots highlight each other.

import { peakColor } from "../config.js";
import { S, perMev, selText } from "../state.js";
import { $, fmt, setText } from "../util.js";
import { isCompact } from "./mobile.js";

/** Areas span many decades: full digits up to 99 999, then three significant figures. */
const fmtArea = (v) => (!Number.isFinite(v) ? "—" : Math.abs(v) < 1e5 ? v.toFixed(0) : v.toExponential(2).replace("e+", "e"));

// Sort keys: the value each column sorts by (peak number = wavelength order, the colour order)
const SORT = {
  n: (p, i) => i,
  pos: (p) => (S.unit === "eV" ? p.energyEv : p.measuredPeak),
  fwhm: (p) => (S.unit === "eV" ? p.fwhmEv : p.fwhmNm),
  height: (p) => p.rawIntensity,
  area: (p) => p.integratedIntensity,
  snr: (p) => p.snr,
};

/** Peak indices in table order. */
function tableOrder() {
  const { key, dir } = S.peakSort;
  const val = SORT[key];
  return S.peaks.map((p, i) => i).sort((a, b) => {
    const va = val(S.peaks[a], a), vb = val(S.peaks[b], b);
    return (Number.isFinite(va) ? va : -Infinity) < (Number.isFinite(vb) ? vb : -Infinity) ? -dir : dir;
  });
}

/** Click a header to sort by it; again to reverse. Measured values start with the largest first. */
export function sortBy(key) {
  S.peakSort = S.peakSort.key === key
    ? { key, dir: -S.peakSort.dir }
    : { key, dir: key === "n" || key === "pos" ? 1 : -1 };
  updatePeakList();
}

/** `onHover(i)` gets the peak index under the pointer (-1 on leaving); `onClick(i)` a clicked row's peak. */
export function initPeakTable({ onHover, onClick }) {
  const body = $("peakList");
  const peakOf = (e) => {
    const tr = e.target.closest("tr");
    return tr ? +tr.dataset.i : -1;
  };
  body.addEventListener("mouseover", (e) => onHover(peakOf(e)));
  body.addEventListener("mouseleave", () => onHover(-1));
  body.addEventListener("click", (e) => { const i = peakOf(e); if (i >= 0) onClick(i); });
  document.querySelector(".peak-table thead").addEventListener("click", (e) => {
    const key = e.target.closest("button")?.dataset.sort;
    if (key) sortBy(key);
  });
}

/** Mark the hovered and the focused (zoomed-to) peak's rows. */
export function markRows() {
  for (const tr of $("peakList").children) {
    const i = +tr.dataset.i;
    tr.classList.toggle("hl", i === S.hoverPeak);
    tr.classList.toggle("focus", i === S.focusPeak);
  }
}

export function updatePeakList() {
  const eV = S.unit === "eV";
  setText($("uPos"), eV ? "eV" : "nm");
  setText($("uAlt"), eV ? "nm" : "eV");
  setText($("uFwhm"), eV ? "eV" : "nm");
  setText($("uHeight"), perMev() ? "cts/meV" : "cts");
  for (const th of document.querySelectorAll(".peak-table th")) {
    const key = th.querySelector("button").dataset.sort;
    // The second Position / Height column mirrors the first; only one header carries the arrow
    const owner = th.classList.contains("c-ext") ? null : key;
    const custom = S.peakSort.key !== "n" || S.peakSort.dir !== 1; // the default order needs no arrow
    if (custom && owner === S.peakSort.key) th.setAttribute("aria-sort", S.peakSort.dir > 0 ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  }

  const body = $("peakList");
  while (body.children.length > S.peaks.length) body.lastElementChild.remove();
  while (body.children.length < S.peaks.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = '<td class="c-n"><span class="pdot"></span><span></span></td><td class="c-pos"><span></span><small></small></td>'
      + '<td class="c-ext"></td><td></td><td class="c-h"></td><td class="c-ext"></td><td></td><td></td>';
    body.append(tr);
  }
  const maxHeight = S.peaks.reduce((m, p) => Math.max(m, p.rawIntensity), 0) || 1;
  tableOrder().forEach((i, row) => {
    const p = S.peaks[i], tr = body.children[row];
    const [n, pos, alt, fwhm, height, rel, area, snr] = tr.children;
    const strongest = i === S.mainPeak;
    tr.dataset.i = i;
    tr.classList.toggle("max", strongest);
    tr.title = strongest ? "Strongest peak" : "";
    tr.style.setProperty("--pc", peakColor(i));
    tr.style.setProperty("--rel", Math.max(0, p.rawIntensity / maxHeight).toFixed(3));
    n.firstChild.style.background = peakColor(i);
    setText(n.lastChild, String(i + 1));
    const main = eV ? fmt(p.energyEv, 4) : fmt(p.measuredPeak, 3);
    const other = eV ? `${fmt(p.measuredPeak, 2)} nm` : `${fmt(p.energyEv, 4)} eV`;
    setText(pos.firstChild, main);
    setText(pos.lastChild, other);
    setText(alt, other.split(" ")[0]);
    setText(fwhm, eV ? fmt(p.fwhmEv, 4) : fmt(p.fwhmNm, 2));
    setText(height, p.rawIntensity.toFixed(0));
    setText(rel, `${Math.round((100 * p.rawIntensity) / maxHeight)} %`);
    setText(area, fmtArea(p.integratedIntensity));
    setText(snr, p.snr >= 1000 ? ">999" : p.snr.toFixed(0));
  });
  markRows();

  const has = S.peaks.length > 0;
  setText($("peakCount"), String(S.peaks.length));
  setText($("peakCountStrip"), String(S.peaks.length));
  $("peaksCsvBtn").disabled = !has;
  $("peaksCopy").disabled = !has;
  $("peakFoot").hidden = !has;
  $("peakEmpty").hidden = has;
  $("peakEmpty").innerHTML = !S.detect
    ? "<b>Peak detection is off</b>Turn on Detect to find every peak and list it here."
    : !S.frame ? "<b>No spectrum yet</b>Every peak above the noise will be listed here."
      : S.sel ? "<b>No peaks in the selection</b>Widen the range or clear it with Esc."
        : "<b>No peaks found</b>The spectrum has no line above the noise.";
}

/** The table as tab-separated text with units, in the order shown, for pasting into a spreadsheet. */
export function peakTableText() {
  const eV = S.unit === "eV";
  const head = ["peak", "wavelength_nm", "energy_eV", eV ? "fwhm_eV" : "fwhm_nm", perMev() ? "height_counts_per_meV" : "height_counts",
    "relative_height_%", "area", "snr"];
  const maxHeight = S.peaks.reduce((m, p) => Math.max(m, p.rawIntensity), 0) || 1;
  const rows = tableOrder().map((i) => {
    const p = S.peaks[i];
    return [i + 1, p.measuredPeak.toFixed(3), p.energyEv.toFixed(4), eV ? fmt(p.fwhmEv, 4) : fmt(p.fwhmNm, 3),
      p.rawIntensity.toFixed(0), ((100 * p.rawIntensity) / maxHeight).toFixed(1), fmt(p.integratedIntensity, 0), p.snr.toFixed(1)].join("\t");
  });
  return [head.join("\t"), ...rows].join("\n");
}

/** What detection searches, under the panel header, and the selection chip above the plot. */
export function updateScope() {
  const scope = $("detectScope");
  scope.hidden = !S.detect;
  if (S.sel) {
    scope.innerHTML = `Searching <span class="sel-tag"><b class="mono">${selText()}</b>`
      + '<button data-act="clear-sel" title="Search the whole spectrum (Esc)" aria-label="Clear the selection"><svg class="i"><use href="#i-x"/></svg></button></span>';
  } else {
    scope.innerHTML = `Searching the <b>whole spectrum</b> · ${isCompact() ? "tap a peak" : "drag on the plot"} to narrow it`;
  }

  $("selChip").hidden = !S.sel;
  if (S.sel) $("selText").textContent = selText();
}
