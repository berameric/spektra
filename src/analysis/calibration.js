// Wavelength calibration against lamps with known lines: reference line sets, automatic matching of detected
// peaks to those lines, and a small polynomial correction added to the instrument's own (factory) calibration.
// Wavelengths are in air, nm (NIST Atomic Spectra Database values, as lamp line tables list them).

/** Reference sources. `lines` are the lines expected in the spectrum; weak or missing ones are simply not matched. */
export const LINE_SETS = {
  fluorescent: {
    name: "Fluorescent room light",
    note: "Mercury lines of an ordinary fluorescent tube or compact lamp; the broad phosphor bands are ignored.",
    lines: [404.656, 407.783, 435.833, 546.074, 576.960, 579.066],
  },
  hgar: {
    name: "Mercury-argon lamp",
    note: "Pen lamps such as the Ocean HG-1: mercury in the blue and green, argon in the red and near infrared.",
    lines: [
      253.652, 296.728, 302.150, 313.155, 334.148, 365.015, 404.656, 407.783, 435.833, 546.074, 576.960,
      579.066, 696.543, 706.722, 714.704, 727.294, 738.398, 750.387, 763.511, 772.376, 794.818, 800.616,
      811.531, 826.452, 842.465, 852.144, 866.794, 912.297, 922.450,
    ],
  },
  neon: {
    name: "Neon lamp",
    note: "Dense lines between 540 and 750 nm; good for the red part of the spectrum.",
    lines: [
      540.056, 585.249, 588.190, 594.483, 597.553, 603.000, 607.434, 609.616, 614.306, 616.359, 621.728,
      626.650, 630.479, 633.443, 638.299, 640.225, 650.653, 653.288, 659.895, 667.828, 671.704, 692.947,
      703.241, 717.394, 724.517, 743.890,
    ],
  },
};

/** Lasers with a defined line. Diode and DPSS lasers vary by up to a few nm between units, so they are not listed. */
export const LASERS = [
  { name: "He-Ne", nm: 632.816 },
  { name: "Argon ion, blue", nm: 487.986 },
  { name: "Argon ion, green", nm: 514.532 },
  { name: "Krypton ion, red", nm: 647.088 },
];

// The correction is a polynomial in u = (λ − CENTER) / SPAN, so its coefficients are all in nm and comparable
const CENTER = 600, SPAN = 400;

/** Polynomial degree the number of lines supports: offset, then linear, quadratic from four lines on. */
export const degreeFor = (n) => (n >= 4 ? 2 : n >= 2 ? 1 : 0);

/** Correction in nm at factory wavelength `nm`. */
export function correctionAt(cal, nm) {
  const u = (nm - CENTER) / SPAN;
  return cal.coeffs.reduce((s, c, k) => s + c * u ** k, 0);
}

/** The calibrated axis: factory wavelengths plus the correction. */
export const applyCalibration = (wl, cal) => (cal ? Float64Array.from(wl, (x) => x + correctionAt(cal, x)) : wl);

/** Least-squares polynomial of `degree` through (x, y), solved by Gaussian elimination on the normal equations. */
function polyfit(xs, ys, degree) {
  const m = degree + 1;
  const A = Array.from({ length: m }, () => new Float64Array(m + 1));
  xs.forEach((x, i) => {
    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) A[r][c] += x ** (r + c);
      A[r][m] += ys[i] * x ** r;
    }
  });
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c || !A[c][c]) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return Array.from({ length: m }, (_, k) => A[k][m] / A[k][k]);
}

/**
 * Fit the correction to pairs {measured, reference} (factory nm, true nm). The degree follows the number of
 * pairs unless given. Returns { coeffs, degree, rms, residuals } with residuals = reference − calibrated, in nm.
 */
export function fitCalibration(pairs, degree = degreeFor(pairs.length)) {
  if (!pairs.length) return null;
  degree = Math.min(degree, pairs.length - 1);
  const coeffs = polyfit(pairs.map((p) => (p.measured - CENTER) / SPAN), pairs.map((p) => p.reference - p.measured), degree);
  const cal = { coeffs, degree };
  const residuals = pairs.map((p) => p.reference - (p.measured + correctionAt(cal, p.measured)));
  // With as many coefficients as lines the fit is exact and says nothing about the error
  const free = pairs.length - (degree + 1);
  const rms = free > 0 ? Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / free) : NaN;
  return { coeffs, degree, rms, residuals };
}

/** Each reference line within the axis paired with the nearest peak within `tol` nm after `map`; a peak is used once. */
function pairUp(peaks, lines, map, tol) {
  const taken = new Map(); // peak index → { line, d }
  for (const line of lines) {
    let best = -1, bestD = tol;
    peaks.forEach((p, i) => {
      const d = Math.abs(map(p.nm) - line);
      if (d <= bestD) { best = i; bestD = d; }
    });
    if (best < 0) continue;
    const prev = taken.get(best);
    if (!prev || bestD < prev.d) taken.set(best, { line, d: bestD });
  }
  return [...taken.entries()].map(([i, { line }]) => ({ peak: peaks[i], measured: peaks[i].nm, reference: line }))
    .sort((a, b) => a.reference - b.reference);
}

/**
 * Match detected peaks ({nm, height}, factory nm) to reference lines. The instrument's own calibration is
 * assumed to be within `maxShiftNm`: every peak–line pair proposes a shift, the shift that pairs the most lines
 * (then the strongest peaks) wins, and the pairing is refined with the fitted correction.
 */
export function matchLines(peaks, lines, { maxShiftNm = 5, tolNm = 0.6, axis = [-Infinity, Infinity] } = {}) {
  const inRange = lines.filter((l) => l >= axis[0] - maxShiftNm && l <= axis[1] + maxShiftNm);
  if (!peaks.length || !inRange.length) return [];
  let best = [], bestScore = [-1, -1];
  for (const p of peaks) {
    for (const line of inRange) {
      const shift = line - p.nm;
      if (Math.abs(shift) > maxShiftNm) continue;
      const pairs = pairUp(peaks, inRange, (x) => x + shift, tolNm);
      const score = [pairs.length, pairs.reduce((s, q) => s + q.peak.height, 0)];
      if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) { best = pairs; bestScore = score; }
    }
  }
  // Refine: the fitted correction predicts every line better than a single shift, so lines further out pair up
  for (let round = 0; round < 3 && best.length; round++) {
    const fit = fitCalibration(best);
    const next = pairUp(peaks, inRange, (x) => x + correctionAt(fit, x), tolNm / 2);
    if (next.length < best.length) break;
    best = next;
  }
  return best;
}

/**
 * Drop the worst-fitting pair while it lies far outside the others (a misidentified or blended line).
 * Keeps at least degree + 2 pairs so the remaining error can still be judged.
 */
export function rejectOutliers(pairs, { floorNm = 0.03, factor = 4 } = {}) {
  let kept = pairs.slice();
  for (;;) {
    const fit = fitCalibration(kept);
    if (!fit || kept.length < fit.degree + 3) return kept;
    const abs = fit.residuals.map(Math.abs);
    const sorted = [...abs].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    const worst = abs.indexOf(sorted[sorted.length - 1]);
    if (abs[worst] <= Math.max(floorNm, factor * median)) return kept;
    kept = kept.filter((_, i) => i !== worst);
  }
}
