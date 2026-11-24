// Node test for the browser analysis port (src/analysis/peaks.js): node tests/test_web_analysis.mjs
import assert from "node:assert/strict";
import { HC_EV_NM, boxcar, evToNm, findPeaks, findSpectralPeaks, nmToEv, peakExtent } from "../src/analysis/peaks.js";

// Deterministic Gaussian noise (Box-Muller over a small LCG)
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

assert.ok(Math.abs(nmToEv(532) - HC_EV_NM / 532) < 1e-9);
assert.ok(Math.abs(evToNm(nmToEv(532)) - 532) < 1e-9);

// scipy.signal.find_peaks reference cases
assert.deepEqual(findPeaks([0, 1, 0, 2, 2, 2, 0, 3, 0]), [1, 4, 7]);
assert.deepEqual(findPeaks([0, 5, 0, 4, 0, 1, 0], { distance: 3 }), [1, 5]);
assert.deepEqual(findPeaks([0, 5, 4, 4.5, 0], { prominence: 1 }), [1]);

// Boxcar: plain moving average, shorter window at the edges, no-op for width 0
assert.deepEqual(Array.from(boxcar([0, 3, 6, 9, 12], 1)), [1.5, 3, 6, 9, 10.5]);
const raw5 = [1, 2, 3];
assert.equal(boxcar(raw5, 0), raw5);

const n = 2068;
const wl = Float64Array.from({ length: n }, (_, i) => 200 + (900 * i) / (n - 1));
const g = (x, c, s) => Math.exp(-0.5 * ((x - c) / s) ** 2);
const inten = Float64Array.from(wl, (x) =>
  1500 + 25000 * g(x, 450, 1.0) + 45000 * g(x, 532, 1.1) + 18000 * g(x, 680, 1.2) + 10 * gauss());

const peaks = findSpectralPeaks(wl, inten, { maxPeaks: 5 });
assert.equal(peaks.length, 3);
assert.ok(Math.abs(peaks[0].measuredPeak - 532) < 0.2, peaks[0].measuredPeak);
assert.ok(Math.abs(peaks[0].energyEv - nmToEv(532)) < 0.005);
assert.ok(Math.abs(peaks[0].fwhmNm - 2.3548 * 1.1) < 0.1, peaks[0].fwhmNm);
assert.ok(Math.abs(peaks[0].integratedIntensity - 45000 * 1.1 * Math.sqrt(2 * Math.PI)) / 124000 < 0.02);

// Range restricted to the 680 nm line
const ranged = findSpectralPeaks(wl, inten, { wlMin: 660, wlMax: 700 });
assert.equal(ranged.length, 1);
assert.ok(Math.abs(ranged[0].measuredPeak - 680) < 0.2);

// Whole-peak extent around 450 nm, and nothing on the flat baseline
const [lo, hi, at] = peakExtent(wl, inten, 450.3, { searchNm: 2 });
assert.ok(lo < 448 && lo > 440 && hi > 452 && hi < 460, `${lo} ${hi}`);
assert.ok(Math.abs(at - 450) < 0.5);
assert.equal(peakExtent(wl, inten, 900, { searchNm: 2 }), null);

console.log("OK: peak analysis passes the reference checks.");
