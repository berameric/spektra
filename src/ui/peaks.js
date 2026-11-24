// Peaks panel: colour-coded list of detected peaks, search scope and the selection chip above the plot.

import { peakColor } from "../config.js";
import { S, selText } from "../state.js";
import { $, fmt, setText } from "../util.js";

export function updatePeakList() {
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

/** Where detection searches (under the Detect switch) and the selection chip above the plot. */
export function updateScope() {
  const scope = $("detectScope");
  scope.hidden = !S.detect;
  if (S.sel) scope.innerHTML = `Searching the selection <b class="mono">${selText()}</b>`;
  else scope.textContent = "Searching the whole spectrum · drag on the plot to narrow it";

  $("selChip").hidden = !S.sel;
  if (S.sel) $("selText").textContent = selText();
}
