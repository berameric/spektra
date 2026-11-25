// Instrument actions: connect, single and live acquisition, exposure (manual and auto) and dark measurement.

import { boxcar, estimateBaseline } from "./analysis/peaks.js";
import { AUTO_INT_BAND, AUTO_INT_TARGET, MAX_INT_MS, MIN_INT_MS, MOCK, SATURATION } from "./config.js";
import { HDXUSB } from "./device/hdx-usb.js";
import { requestRender, showFrame } from "./spectrum.js";
import { S, darkActive } from "./state.js";
import { setDarkStatus, showExposure, updateUi } from "./ui/controls.js";
import { confirmDialog, toast, toastShowing } from "./ui/notify.js";
import { $, clamp } from "./util.js";

/** One spectrum: mean of S.avg scans, dark subtracted when valid, then boxcar smoothed. */
async function acquireFrame() {
  const dev = S.dev, n = S.avg;
  const meta = {
    time: new Date(), model: dev.model, serial: dev.serialNumber, intMs: S.intMs, avg: n, boxcar: S.boxcar,
    darkMs: darkActive() ? S.darkIntMs : null,
  };
  let raw = null, rawMax = 0;
  for (let k = 0; k < n; k++) {
    const scan = await dev.intensities();
    for (const v of scan) if (v > rawMax) rawMax = v;
    if (!raw) raw = Float64Array.from(scan);
    else for (let i = 0; i < raw.length; i++) raw[i] += scan[i];
  }
  if (n > 1) for (let i = 0; i < raw.length; i++) raw[i] /= n;
  let inten = meta.darkMs !== null ? Float64Array.from(raw, (v, i) => v - S.dark[i]) : raw;
  inten = boxcar(inten, S.boxcar);
  return { wl: S.wl, raw, inten, rawMax, meta };
}

/** Auto integration: rescale so the highest peak sits near 80 % of full scale. */
async function autoAdjustIntegration(f) {
  const [base, noise] = estimateBaseline(f.raw);
  const signal = f.rawMax - base, full = SATURATION - base;
  if (signal < 20 * noise && f.rawMax < SATURATION) return; // no real signal to scale on
  const frac = signal / full;
  if (f.rawMax < SATURATION && frac >= AUTO_INT_BAND[0] && frac <= AUTO_INT_BAND[1]) return;
  const ratio = f.rawMax >= SATURATION ? 0.5 : clamp(AUTO_INT_TARGET / frac, 0.1, 10);
  let next = clamp(S.intMs * ratio, MIN_INT_MS, MAX_INT_MS);
  next = next >= 100 ? Math.round(next) : Math.round(next * 10) / 10;
  if (Math.abs(next - S.intMs) / S.intMs > 0.02) {
    await applyIntegration(next, true);
    toast(`Auto exposure set to ${S.intMs} ms`, "info", 3000, "exposure");
  }
}

function connectErrorText(e) {
  const msg = e?.message || String(e);
  if (e?.name === "SecurityError" || /access denied|unable to claim|failed to open|in use/i.test(msg)) {
    const win = /Windows/.test(navigator.userAgent);
    return `HDX connection failed: ${msg}. ` + (win
      ? "On Windows the HDX needs the WinUSB driver (install once with Zadig). Also close other programs using it."
      : "Close other programs using the HDX. On Linux a udev rule is needed for USB access.");
  }
  return `HDX connection failed: ${msg}`;
}

export async function connect() {
  if (S.dev) return disconnect();
  S.busy = true;
  updateUi();
  try {
    let dev;
    if (MOCK) {
      dev = await (await import("./device/mock-hdx.js")).MockHDX.open();
    } else {
      // A single HDX the browser already has permission for opens without the chooser
      const known = (await navigator.usb.getDevices()).filter(HDXUSB.isHDX);
      dev = known.length === 1 ? await HDXUSB.open(known[0]) : await HDXUSB.request();
    }
    S.wl = await dev.wavelengths();
    await dev.setIntegrationUs(S.intMs * 1000);
    S.dev = dev;
    S.dark = null;
    S.darkIntMs = null;
    toast(`Connected: ${dev.model} S/N ${dev.serialNumber}`, "ok");
  } catch (e) {
    if (!(e?.name === "NotFoundError" && /select/i.test(e.message))) toast(connectErrorText(e), "bad", 10000);
  } finally {
    S.busy = false;
    updateUi();
  }
}

async function disconnect() {
  S.live = false;
  const dev = S.dev;
  S.dev = null;
  updateUi();
  if (dev) {
    await dev.close();
    toast(`Disconnected from ${dev.model}`, "info", 3000);
  }
}

/** Notice when the HDX is unplugged, and release it when the page closes. */
export function watchDevice() {
  if (HDXUSB.supported()) {
    navigator.usb.addEventListener("disconnect", (e) => {
      if (S.dev instanceof HDXUSB && S.dev.dev === e.device) {
        S.live = false;
        S.dev = null;
        toast("HDX was unplugged.", "bad");
        updateUi();
      }
    });
  }
  window.addEventListener("beforeunload", () => { if (S.dev) S.dev.close(); });
}

export async function acquireOnce() {
  if (!S.dev || S.live || S.busy) return;
  S.busy = true;
  updateUi();
  const scans = S.avg === 1 ? `${S.intMs} ms` : `${S.avg} × ${S.intMs} ms`;
  if (S.avg * S.intMs > 400) toast(`Acquiring ${scans}…`, "info", 60000, "acq");
  try {
    const f = await acquireFrame();
    showFrame(f);
    toast(`Spectrum acquired — ${scans}, max ${f.rawMax.toFixed(0)} counts`, f.rawMax >= SATURATION ? "bad" : "ok", 4000, "acq");
    if (S.autoInt) await autoAdjustIntegration(f);
  } catch (e) {
    toast(`Acquisition failed: ${e.message}`, "bad", 6000, "acq");
  } finally {
    S.busy = false;
    updateUi();
  }
}

export async function toggleLive() {
  if (S.live) {
    S.live = false;
    updateUi();
    return;
  }
  if (!S.dev || S.busy) return;
  const dev = S.dev;
  S.live = true;
  S.scans = 0;
  updateUi();
  toast("Live view started", "info", 2500, "live");
  let t = performance.now();
  while (S.live && S.dev === dev) {
    try {
      const f = await acquireFrame();
      if (!S.live) break;
      showFrame(f);
      if (S.autoInt) await autoAdjustIntegration(f);
      S.scans++;
      const now = performance.now();
      S.fps = S.fps ? 0.8 * S.fps + 0.2 * (1000 / (now - t)) : 1000 / (now - t);
      t = now;
    } catch (e) {
      if (S.live && S.dev === dev) toast(`Live view stopped: ${e.message}`, "bad", 6000, "live");
      S.live = false;
      break;
    }
  }
  if (S.dev === dev && !toastShowing("live", "bad")) {
    toast(`Live view stopped after ${S.scans} scan${S.scans === 1 ? "" : "s"}`, "ok", 3000, "live");
  }
  S.live = false;
  updateUi();
  requestRender();
}

export async function applyIntegration(ms, auto = false) {
  if (!Number.isFinite(ms)) ms = S.intMs;
  ms = clamp(Math.round(ms * 1000) / 1000, MIN_INT_MS, MAX_INT_MS);
  const changed = ms !== S.intMs;
  S.intMs = ms;
  showExposure(true);
  S.yRange = null;
  if (S.dev) {
    try {
      await S.dev.setIntegrationUs(ms * 1000);
    } catch (e) {
      toast(`Exposure could not be set: ${e.message}`, "bad", 6000, "exposure");
      updateUi();
      return;
    }
  }
  if (changed && !auto) toast(`Exposure set to ${ms} ms`, "info", 2500, "exposure");
  updateUi();
}

export async function takeDark() {
  if (!S.dev || S.live || S.busy) return;
  const ok = await confirmDialog("Background measurement",
    "Block the light (close the shutter or turn the lamp off), then press OK.");
  if (!ok || !S.dev) return;
  const dev = S.dev;
  const n = clamp(Math.round(+$("darkAvg").value) || 10, 1, 500);
  S.busy = true;
  S.measuringDark = true;
  updateUi();
  dev.simulateShutter?.(true); // simulated HDX only: the user cannot block its light
  try {
    const sum = new Float64Array(S.wl.length);
    for (let k = 0; k < n; k++) {
      setDarkStatus(`Measuring ${k + 1} / ${n}…`, "warn", `measuring ${k + 1}/${n}`);
      const raw = await dev.intensities();
      for (let i = 0; i < sum.length; i++) sum[i] += raw[i];
    }
    S.dark = sum.map((v) => v / n);
    S.darkIntMs = S.intMs;
    toast(`Dark stored (${n} × ${S.intMs} ms). Restore the light.`, "ok", 6000);
  } catch (e) {
    toast(`Dark failed: ${e.message}`, "bad");
  } finally {
    dev.simulateShutter?.(false);
    S.busy = false;
    S.measuringDark = false;
    updateUi();
  }
}

export function clearDark() {
  S.dark = null;
  S.darkIntMs = null;
  updateUi();
  toast("Dark cleared — raw counts are shown", "info", 3000);
}
