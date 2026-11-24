// Spectral line & multi-peak analysis: peak positions (nm & eV), FWHM, intensities and SNR.
// Peak detection follows scipy.signal.find_peaks semantics (height, distance, prominence).

// Exact CODATA 2018 h*c/e in eV*nm
export const HC_EV_NM = 1239.8419843320026;

export const nmToEv = (nm) => (nm > 0 ? HC_EV_NM / nm : NaN);
export const evToNm = (ev) => (ev > 0 ? HC_EV_NM / ev : NaN);

function medianSorted(s) {
  const n = s.length;
  if (!n) return NaN;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
}

/** Baseline level and noise from the lower 30 % of pixels (robust for line spectra). */
export function estimateBaseline(intensity) {
  const sorted = Float64Array.from(intensity).sort();
  const lower = sorted.subarray(0, Math.min(sorted.length, Math.max(10, Math.floor(0.3 * sorted.length))));
  const baseline = medianSorted(lower);
  const dev = Float64Array.from(lower, (v) => Math.abs(v - baseline)).sort();
  return [baseline, Math.max(1.4826 * medianSorted(dev), 1e-9)];
}

/** 3-point median filter with 'reflect' edges (scipy.ndimage.median_filter(size=3)). */
export function medianFilter3(y) {
  const n = y.length;
  const out = new Float64Array(n);
  const med = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  for (let i = 0; i < n; i++) {
    out[i] = med(y[Math.max(i - 1, 0)], y[i], y[Math.min(i + 1, n - 1)]);
  }
  return out;
}

/** Boxcar smoothing: mean over 2 * halfWidth + 1 pixels; near the edges over the pixels available. */
export function boxcar(y, halfWidth) {
  const n = y.length, w = Math.floor(halfWidth);
  if (w < 1 || n === 0) return y;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + y[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/** scipy.signal.find_peaks subset: height, distance (samples) and prominence filters. */
export function findPeaks(x, { height = -Infinity, distance = 1, prominence = -Infinity } = {}) {
  const n = x.length;
  // Local maxima (flat tops resolved to their midpoint)
  let peaks = [];
  let i = 1;
  while (i < n - 1) {
    if (x[i - 1] < x[i]) {
      let ahead = i + 1;
      while (ahead < n - 1 && x[ahead] === x[i]) ahead++;
      if (x[ahead] < x[i]) {
        peaks.push((i + ahead - 1) >> 1);
        i = ahead;
      }
    }
    i++;
  }
  peaks = peaks.filter((p) => x[p] >= height);

  // Distance: keep the highest peaks, drop lower neighbours closer than `distance`
  const dist = Math.ceil(distance);
  if (dist > 1 && peaks.length > 1) {
    const keep = peaks.map(() => true);
    const order = peaks.map((_, k) => k).sort((a, b) => x[peaks[a]] - x[peaks[b]]);
    for (let o = order.length - 1; o >= 0; o--) {
      const j = order[o];
      if (!keep[j]) continue;
      for (let k = j - 1; k >= 0 && peaks[j] - peaks[k] < dist; k--) keep[k] = false;
      for (let k = j + 1; k < peaks.length && peaks[k] - peaks[j] < dist; k++) keep[k] = false;
    }
    peaks = peaks.filter((_, k) => keep[k]);
  }

  // Prominence over the full signal (wlen = None)
  return peaks.filter((p) => {
    let leftMin = x[p];
    for (let k = p; k >= 0 && x[k] <= x[p]; k--) leftMin = Math.min(leftMin, x[k]);
    let rightMin = x[p];
    for (let k = p; k < n && x[k] <= x[p]; k++) rightMin = Math.min(rightMin, x[k]);
    return x[p] - Math.max(leftMin, rightMin) >= prominence;
  });
}

function halfMaxCrossing(x, y, i0, i1, half) {
  const y0 = y[i0], y1 = y[i1];
  if (y1 === y0) return x[i0];
  return x[i0] + ((half - y0) * (x[i1] - x[i0])) / (y1 - y0);
}

/** Measure sub-pixel peak wavelength, photon energy, FWHM (nm & eV), intensity, and SNR. */
function measurePeakAt(wl, raw, y, iPeak, noise) {
  const peakVal = y[iPeak];
  if (peakVal <= 3 * noise || iPeak <= 0 || iPeak >= wl.length - 1) return null;

  // Sub-pixel peak: parabolic fit on log intensity (exact for Gaussian lines)
  const ya = y[iPeak - 1], yb = y[iPeak], yc = y[iPeak + 1];
  let delta;
  if (Math.min(ya, yb, yc) > 0) {
    const la = Math.log(ya), lb = Math.log(yb), lc = Math.log(yc);
    const denom = la - 2 * lb + lc;
    delta = denom !== 0 ? (0.5 * (la - lc)) / denom : 0;
  } else {
    const denom = ya - 2 * yb + yc;
    delta = denom !== 0 ? (0.5 * (ya - yc)) / denom : 0;
  }
  delta = Math.min(0.5, Math.max(-0.5, delta));
  const step = delta >= 0 ? wl[iPeak + 1] - wl[iPeak] : wl[iPeak] - wl[iPeak - 1];
  const peakWl = wl[iPeak] + delta * step;

  // FWHM by interpolated half-maximum crossings
  const half = peakVal / 2;
  let left = iPeak;
  while (left > 0 && y[left] > half) left--;
  let right = iPeak;
  while (right < y.length - 1 && y[right] > half) right++;
  let fwhmNm = NaN, fwhmEv = NaN;
  if (left !== 0 && right !== y.length - 1) {
    const xLo = halfMaxCrossing(wl, y, left, left + 1, half);
    const xHi = halfMaxCrossing(wl, y, right - 1, right, half);
    fwhmNm = xHi - xLo;
    if (xLo > 0 && xHi > 0) fwhmEv = Math.abs(nmToEv(xLo) - nmToEv(xHi));
  }

  // Integrated intensity within +/- 1.5 FWHM of the centre (~ 99.9 % of a Gaussian)
  const halfWidth = Number.isFinite(fwhmNm) ? 1.5 * fwhmNm : 5.0;
  let integrated = 0, count = 0, prev = -1;
  for (let k = 0; k < wl.length; k++) {
    if (Math.abs(wl[k] - peakWl) > halfWidth) continue;
    if (prev >= 0) integrated += 0.5 * (y[prev] + y[k]) * (wl[k] - wl[prev]);
    prev = k;
    count++;
  }

  return {
    measuredPeak: peakWl,
    energyEv: nmToEv(peakWl),
    fwhmNm,
    fwhmEv,
    peakIntensity: peakVal,
    rawIntensity: raw[iPeak],
    integratedIntensity: count > 1 ? integrated : NaN,
    snr: peakVal / noise,
  };
}

/**
 * Find multiple peaks in the full spectrum or inside [wlMin, wlMax] (in nm).
 * Returns peaks sorted by descending peakIntensity so index 0 is always the strongest peak.
 */
export function findSpectralPeaks(wavelength, intensity, {
  wlMin = null, wlMax = null, maxPeaks = 10, minSnr = 5.0,
  minProminenceFrac = 0.05, minDistanceNm = 2.0,
} = {}) {
  const wl = wavelength, raw = intensity;
  if (wl.length < 5) return [];

  const [baseline, noise] = estimateBaseline(raw);
  const y = Float64Array.from(raw, (v) => v - baseline);
  const smooth = medianFilter3(y);

  const ranged = wlMin != null && wlMax != null;
  const lo = ranged ? Math.min(wlMin, wlMax) : -Infinity;
  const hi = ranged ? Math.max(wlMin, wlMax) : Infinity;
  const idx = [];
  for (let k = 0; k < wl.length; k++) if (wl[k] >= lo && wl[k] <= hi) idx.push(k);
  if (idx.length < 3) return [];

  const subSmooth = Float64Array.from(idx, (k) => smooth[k]);
  let maxInRegion = -Infinity;
  for (const v of subSmooth) maxInRegion = Math.max(maxInRegion, v);
  if (maxInRegion <= minSnr * noise) return [];

  const diffs = [];
  for (let k = 1; k < wl.length; k++) diffs.push(Math.abs(wl[k] - wl[k - 1]));
  const pxStep = diffs.length ? medianSorted(Float64Array.from(diffs).sort()) : 0.5;
  const minDistPx = Math.max(1, Math.round(minDistanceNm / Math.max(pxStep, 1e-6)));

  const minLevel = Math.max(minSnr * noise, minProminenceFrac * maxInRegion);
  let relPeaks = findPeaks(subSmooth, { height: minLevel, prominence: minLevel, distance: minDistPx });
  if (!relPeaks.length) {
    let best = 0;
    for (let k = 1; k < subSmooth.length; k++) if (subSmooth[k] > subSmooth[best]) best = k;
    relPeaks = [best];
  }

  const results = [];
  for (const rp of relPeaks) {
    let g = idx[rp];
    const loI = Math.max(1, g - 1), hiI = Math.min(wl.length - 2, g + 1);
    g = loI;
    for (let k = loI + 1; k <= hiI; k++) if (y[k] > y[g]) g = k;
    const res = measurePeakAt(wl, raw, y, g, noise);
    if (res && (!ranged || (res.measuredPeak >= lo && res.measuredPeak <= hi))) results.push(res);
  }
  results.sort((a, b) => b.peakIntensity - a.peakIntensity);
  return results.slice(0, Math.max(1, Math.floor(maxPeaks)));
}

/**
 * Full extent of the peak closest to `nearNm` (the strongest maximum within +/- searchNm).
 * Walks outward from the maximum until the signal falls back to the baseline (floorFrac of the
 * peak height, at least 3 noise) or reaches a valley before a neighbouring peak.
 * Returns [loNm, hiNm, peakNm], or null when no significant peak is there.
 */
export function peakExtent(wavelength, intensity, nearNm, { searchNm = 5.0, minSnr = 5.0, floorFrac = 0.02 } = {}) {
  const wl = wavelength;
  if (wl.length < 5) return null;
  const [baseline, noise] = estimateBaseline(intensity);
  const y = medianFilter3(Float64Array.from(intensity, (v) => v - baseline));

  let iPeak = -1;
  for (let k = 0; k < wl.length; k++) {
    if (Math.abs(wl[k] - nearNm) <= searchNm && (iPeak < 0 || y[k] > y[iPeak])) iPeak = k;
  }
  if (iPeak < 0) {
    iPeak = 0;
    for (let k = 1; k < wl.length; k++) if (Math.abs(wl[k] - nearNm) < Math.abs(wl[iPeak] - nearNm)) iPeak = k;
  }
  const peakVal = y[iPeak];
  if (peakVal <= minSnr * noise) return null;

  const floor = Math.max(floorFrac * peakVal, 3 * noise);
  const rise = 2 * noise; // tolerated noise before a rising flank counts as the next peak
  let left = iPeak;
  while (left > 0 && y[left] > floor && y[left - 1] <= y[left] + rise) left--;
  let right = iPeak;
  while (right < y.length - 1 && y[right] > floor && y[right + 1] <= y[right] + rise) right++;
  const a = wl[left], b = wl[right];
  return [Math.min(a, b), Math.max(a, b), wl[iPeak]];
}
