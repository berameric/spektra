// Fixed settings: instrument limits, detection criteria, colours and storage keys.

export const MIN_INT_MS = 6, MAX_INT_MS = 10000;
export const INT_STEPS = [6, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
export const SATURATION = 65000; // 16-bit ADC
export const AUTO_INT_TARGET = 0.8, AUTO_INT_BAND = [0.6, 0.9]; // highest peak as a fraction of full scale
export const DEFAULT_RANGE = { nm: [200, 1100], eV: [1.1, 6.2] };

// Automatic detection: every peak 5x above the noise and 1 % of the strongest one, no count limit
export const AUTO_PEAKS = { maxPeaks: Infinity, minSnr: 5, minProminenceFrac: 0.01 };

// Peak colours (cycled by wavelength order); the same colour marks a peak on the plot and in the list
const PEAK_COLORS = ["#ef4444", "#3b82f6", "#10b981", "#eab308", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#6366f1", "#14b8a6"];
export const peakColor = (i) => PEAK_COLORS[i % PEAK_COLORS.length];

export const STORE_THEME = "hdx.theme";
export const STORE_ENV = "hdx.envNotice.v1";
