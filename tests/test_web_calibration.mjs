// Node test for the wavelength calibration (src/analysis/calibration.js): node tests/test_web_calibration.mjs
import assert from "node:assert/strict";
import { LINE_SETS, applyCalibration, correctionAt, degreeFor, fitCalibration, matchLines, rejectOutliers } from "../src/analysis/calibration.js";
import { findSpectralPeaks } from "../src/analysis/peaks.js";

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

assert.deepEqual([1, 2, 3, 4, 9].map(degreeFor), [0, 1, 1, 2, 2]);

// One line: an offset; two: offset and scale, exact; the error is unknown (rms NaN) without spare lines
const one = fitCalibration([{ measured: 546.5, reference: 546.074 }]);
assert.equal(one.degree, 0);
assert.ok(Math.abs(correctionAt(one, 300) + 0.426) < 1e-9);
assert.ok(Number.isNaN(one.rms));
const two = fitCalibration([{ measured: 435.5, reference: 435.833 }, { measured: 545.6, reference: 546.074 }]);
assert.equal(two.degree, 1);
assert.ok(two.residuals.every((r) => Math.abs(r) < 1e-9));

// The instrument reads every line too short by 0.3–0.7 nm, curving with wavelength
const err = (x) => 0.45 + 0.0009 * (x - 550) + 1.5e-6 * (x - 550) ** 2;
const n = 2068;
const wl = Float64Array.from({ length: n }, (_, i) => 199.6 + 0.4378 * i - 1.2e-6 * i * i);
const lines = LINE_SETS.hgar.lines;
const inten = Float64Array.from(wl, (x) => {
  const t = x + err(x); // true wavelength seen by this pixel
  let v = 1500 + 8 * gauss();
  lines.forEach((c, k) => { v += (3000 + 9000 * ((k * 37) % 5)) * Math.exp(-0.5 * ((t - c) / 0.75) ** 2); });
  v += 20000 * Math.exp(-0.5 * ((t - 620) / 21) ** 2); // broad band, not a line
  return v;
});
const peaks = findSpectralPeaks(wl, inten, { maxPeaks: 80, minSnr: 5, minProminenceFrac: 0.002, minDistanceNm: 0.8 })
  .map((p) => ({ nm: p.measuredPeak, height: p.peakIntensity }));
const pairs = rejectOutliers(matchLines(peaks, lines, { axis: [wl[0], wl[n - 1]] }));
const visible = lines.filter((l) => l > wl[0] + 2 && l < wl[n - 1] - 2);
assert.ok(pairs.length >= visible.length - 2, `${pairs.length} of ${visible.length} lines matched`);
for (const p of pairs) assert.ok(Math.abs(p.measured + err(p.measured) - p.reference) < 0.08, `${p.reference}: ${p.measured}`);
const fit = fitCalibration(pairs);
assert.equal(fit.degree, 2);
assert.ok(fit.rms < 0.02, `rms ${fit.rms}`);
const cal = applyCalibration(wl, fit);
for (const x of [300, 550, 800]) {
  const i = wl.findIndex((w) => w >= x);
  assert.ok(Math.abs(cal[i] - (wl[i] + err(wl[i]))) < 0.03, `${x} nm: ${cal[i] - wl[i]} vs ${err(wl[i])}`);
}

// Fluorescent lamp seen through the same instrument: only mercury lines, one weak, plus phosphor bands
const fl = Float64Array.from(wl, (x) => {
  const t = x + err(x);
  let v = 1500 + 8 * gauss();
  for (const [c, a] of [[404.656, 6000], [435.833, 20000], [546.074, 30000], [576.960, 4000], [579.066, 4500]]) {
    v += a * Math.exp(-0.5 * ((t - c) / 0.75) ** 2);
  }
  for (const [c, a] of [[487.7, 5000], [543.5, 7000], [611.6, 15000]]) v += a * Math.exp(-0.5 * ((t - c) / 2.5) ** 2);
  return v;
});
const flPeaks = findSpectralPeaks(wl, fl, { maxPeaks: 80, minSnr: 5, minProminenceFrac: 0.002, minDistanceNm: 0.8 })
  .map((p) => ({ nm: p.measuredPeak, height: p.peakIntensity }));
const flPairs = rejectOutliers(matchLines(flPeaks, LINE_SETS.fluorescent.lines, { axis: [wl[0], wl[n - 1]] }));
assert.deepEqual(flPairs.map((p) => p.reference), [404.656, 435.833, 546.074, 576.960, 579.066]);

// A misidentified line is dropped
const bad = [...pairs, { measured: 500, reference: 501.5 }];
assert.ok(!rejectOutliers(bad).some((p) => p.measured === 500));

// Nothing to match
assert.deepEqual(matchLines([], lines), []);
assert.deepEqual(matchLines([{ nm: 100, height: 1 }], lines), []);

console.log("OK: wavelength calibration matches lamp lines and fits the correction.");
