// Fixed settings: instrument limits, detection criteria, colours and storage keys.

export const INT_STEPS = [6, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
export const AUTO_INT_TARGET = 0.8, AUTO_INT_BAND = [0.6, 0.9]; // highest peak as a fraction of full scale
export const DEFAULT_RANGE = { nm: [200, 1100], eV: [1.1, 6.2] };

// Automatic detection: every peak 5x above the noise and 1 % of the strongest one, no count limit
export const AUTO_PEAKS = { maxPeaks: Infinity, minSnr: 5, minProminenceFrac: 0.01 };

// Peak colours (cycled by wavelength order); the same colour marks a peak on the plot and in the list.
// The values are theme tokens (--pk-1 … --pk-7 in spektra.css); loadPeakColors() reads them after a theme change.
let PEAK_COLORS = ["#2a78d6"];
export function loadPeakColors() {
  const css = getComputedStyle(document.documentElement);
  PEAK_COLORS = Array.from({ length: 7 }, (_, k) => css.getPropertyValue(`--pk-${k + 1}`).trim()).filter(Boolean);
}
export const peakColor = (i) => PEAK_COLORS[i % PEAK_COLORS.length];

export const STORE_ENV = "hdx.envNotice.v1";
export const STORE_HINTS = "spektra.hints.v1";
export const STORE_GUIDE = "spektra.guide.v1";
export const STORE_RAIL = "spektra.rail.v1";

// Diagnostics page for the instrument (read-only): add ?diag to the address, on the published site too
export const DIAG = new URLSearchParams(location.search).has("diag");

// Development: http://localhost:8000/?mock replaces the HDX with a simulated one (src/device/mock-hdx.js)
export const MOCK = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("mock");
