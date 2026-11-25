// Simulated HDX for development: same interface as ObpInstrument (src/device/obp-instrument.js), no hardware needed.
// Enabled only on localhost with ?mock in the address (see MOCK in config.js); never loaded otherwise.
//
// The "lamp" is a mercury-argon pen-lamp line set plus a broad photoluminescence band. Counts scale with the
// exposure, carry shot and read noise, sit on a detector offset and clip at 65 535 like the real detector.
// The reported wavelengths are off by 0.3-0.8 nm, as a drifted factory calibration, so that the wavelength
// calibration has something to correct.

import { PROFILES } from "./profiles.js";

const PROFILE = PROFILES.find((p) => p.model === "HDX");
const PIXELS = PROFILE.pixels;
const FULL_SCALE = PROFILE.fullScale;
// [centre nm, sigma nm, counts per ms of exposure]
const LINES = [
  [404.656, 0.8, 90], [435.833, 0.8, 240], [546.074, 0.85, 350], [576.960, 0.9, 70], [579.066, 0.9, 75],
  [696.543, 0.9, 30], [706.722, 0.9, 20], [738.398, 0.9, 18], [750.387, 0.9, 35], [763.511, 0.9, 70],
  [772.376, 0.9, 20], [794.818, 0.9, 25], [811.531, 0.9, 55], [842.465, 0.9, 28], [912.297, 0.9, 30],
  [620, 21, 120], // broad emission band, FWHM ≈ 50 nm
];
const WL_ERROR = (nm) => 0.45 + 0.0009 * (nm - 550) + 1.5e-6 * (nm - 550) ** 2; // true − reported
const OFFSET = 1500, DARK_PER_MS = 0.4, READ_NOISE = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export class MockHDX {
  static async open() {
    await sleep(300);
    return new MockHDX();
  }

  constructor() {
    this.model = "HDX";
    this.profile = PROFILE;
    this.fullScale = PROFILE.fullScale;
    this.serialNumber = "MOCK0001";
    this.intUs = 100000;
    this.shutterClosed = false;
    // Fixed per-pixel offset pattern and a slightly non-linear wavelength calibration, like a real unit
    this.wl = Float64Array.from({ length: PIXELS }, (_, i) => 199.6 + 0.4378 * i - 1.2e-6 * i * i);
    this.trueWl = this.wl.map((x) => x + WL_ERROR(x));
    this.pattern = Float64Array.from({ length: PIXELS }, () => 4 * gauss());
    this.t0 = performance.now();
  }

  async wavelengths() { return Float64Array.from(this.wl); }

  async setIntegrationUs(us) { this.intUs = us; }

  /** Dark measurements call this so the simulated light is blocked while they run. */
  simulateShutter(closed) { this.shutterClosed = closed; }

  async intensities() {
    const ms = this.intUs / 1000;
    await sleep(Math.max(ms, 15));
    const drift = 1 + 0.03 * Math.sin((performance.now() - this.t0) / 4000); // slow lamp drift
    const out = new Uint16Array(PIXELS);
    for (let i = 0; i < PIXELS; i++) {
      const x = this.trueWl[i];
      let light = 0;
      if (!this.shutterClosed) {
        for (const [c, s, rate] of LINES) {
          const d = (x - c) / s;
          if (d * d < 60) light += rate * ms * drift * Math.exp(-0.5 * d * d);
        }
      }
      const signal = light + DARK_PER_MS * ms;
      const v = OFFSET + this.pattern[i] + signal + Math.sqrt(signal + READ_NOISE ** 2) * gauss();
      out[i] = Math.max(0, Math.min(FULL_SCALE, Math.round(v)));
    }
    return out;
  }

  /** Like the HDX: 0x00101000 returns the simulated spectrum as 16-bit pixels, other messages error 2. */
  async readMessage(msgType) {
    if (msgType !== 0x00101000) throw new Error("Instrument error 2: unknown message type");
    const px = await this.intensities();
    const out = new Uint8Array(px.length * 2);
    const v = new DataView(out.buffer);
    px.forEach((c, i) => v.setUint16(2 * i, c, true));
    return out;
  }

  async close() {}
}
