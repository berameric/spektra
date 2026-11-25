// Application state shared by all modules, and conversions into the display unit.

import { evToNm, nmToEv } from "./analysis/peaks.js";

export const S = {
  dev: null, wl: null, intMs: 100, unit: "nm",
  avg: 1, boxcar: 0, autoInt: false,
  dark: null, darkIntMs: null, subtractDark: true,
  live: false, busy: false, measuringDark: false, scans: 0, fps: 0, saturated: false,
  frame: null, // {wl, raw, inten, rawMax, meta}
  disp: null,  // {x, y} in the display unit, x ascending
  sel: null,   // selected range {lo, hi} in nm; never stored
  detect: true,
  jacobian: true, // on the eV axis: counts per meV (I·λ²/hc) instead of counts per pixel
  peaks: [],    // detected peaks, ascending wavelength
  mainPeak: -1, // index of the strongest detected peak
  hoverPeak: -1, // peak under the pointer, in the table or on the plot
  focusPeak: -1, // peak whose row was clicked: the plot is zoomed to it
  peakSort: { key: "n", dir: 1 }, // table order
  yRange: null,
  logY: false,
  ref: null,     // held reference spectrum {wl, inten, time}, drawn under the live one
  refDisp: null, // the reference in the display unit
};

export const toDisp = (nm) => (S.unit === "eV" ? nmToEv(nm) : nm);
export const fromDisp = (x) => (S.unit === "eV" ? evToNm(x) : x);
export const dispRange = (loNm, hiNm) => {
  const a = toDisp(loNm), b = toDisp(hiNm);
  return a < b ? [a, b] : [b, a];
};

/** eV axis with the Jacobian conversion: intensities are counts per meV. */
export const perMev = () => S.unit === "eV" && S.jacobian;
export const intensityUnit = () => (perMev() ? "counts/meV" : "counts");

/** The selected range as text in the display unit. */
export function selText() {
  const d = S.unit === "eV" ? 3 : 2;
  const [a, b] = dispRange(S.sel.lo, S.sel.hi);
  return `${a.toFixed(d)} – ${b.toFixed(d)} ${S.unit}`;
}

// A dark spectrum is valid only at the exposure it was measured with
export const darkValid = () => S.dark !== null && Math.abs(S.darkIntMs - S.intMs) < 1e-6;
export const darkActive = () => S.subtractDark && darkValid();
