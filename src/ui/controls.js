// Control states: top bar, signal meter, first-run guide, processing chain and the popovers that set it.
// Whatever needs the user's attention next (connect, dark, exposure) is emphasised here.

import { MOCK, SATURATION, STORE_GUIDE } from "../config.js";
import { HDXUSB } from "../device/hdx-usb.js";
import { S, darkValid } from "../state.js";
import { $, clamp, store } from "../util.js";

export const usbAvailable = () => MOCK || (HDXUSB.supported() && window.isSecureContext);

export function updateUi() {
  const c = !!S.dev, usb = usbAvailable();
  $("simBadge").hidden = !MOCK;
  $("connectBtn").hidden = c;
  $("connectBtn").disabled = S.busy || !usb;
  $("disconnectBtn").hidden = !c;
  $("conn").classList.toggle("on", c);
  $("led").className = `led${c ? " on" : ""}${S.live ? " live" : ""}`;
  $("devInfo").innerHTML = c ? `${S.dev.model}<span id="devSerial"> · S/N ${S.dev.serialNumber}</span>` : S.busy ? "Connecting…" : "No device";
  $("acqBtn").disabled = !c || S.live || S.busy;
  $("liveBtn").disabled = !c || S.busy;
  $("liveLabel").textContent = S.live ? "Stop" : "Live";
  $("liveBtn").classList.toggle("stop", S.live);
  $("liveBtn").classList.toggle("primary", c && !S.live);
  $("darkBtn").disabled = !c || S.live || S.busy;
  $("darkClear").disabled = S.dark === null || S.busy;
  if (!S.measuringDark) {
    if (S.dark === null) setDarkStatus("No dark taken — raw counts are shown.", "warn", "none");
    else if (!darkValid()) setDarkStatus(`Taken at ${S.darkIntMs} ms, exposure is now ${S.intMs} ms — retake it.`, "bad", "retake");
    else if (!S.subtractDark) setDarkStatus(`Valid (${S.darkIntMs} ms) but not subtracted.`, "warn", "off");
    else setDarkStatus(`Subtracting the dark taken at ${S.darkIntMs} ms.`, "ok", "subtracted");
  }
  // Connected without a valid dark: the Dark stage asks for attention
  const darkStage = $("darkStageBtn");
  darkStage.classList.toggle("attn", c && !S.measuringDark && (!darkValid() || !S.subtractDark));
  darkStage.classList.toggle("bad", c && S.dark !== null && !darkValid());
  // Auto sets the exposure: the manual controls are disabled while it is on
  for (const id of ["intInput", "intUp", "intDown"]) $(id).disabled = S.autoInt;
  $("expoBox").classList.toggle("auto", S.autoInt);
  showExposure();
  updateGuide();
  updateChain();
  updateMeter();
  if (!S.live) $("scanInfo").textContent = "";
}

let guideClosed = store.get(STORE_GUIDE) === "1";

/** The steps are optional: closing the guide leaves a one-line note; Help → Getting started brings it back. */
export function showGuide(on) {
  guideClosed = !on;
  store.set(STORE_GUIDE, on ? "0" : "1");
  updateGuide();
}

/** First-run steps shown on the empty plot; the first unfinished one is current and carries the action. */
function updateGuide() {
  // Without WebUSB the system check explains what to do instead
  const guide = !guideClosed && usbAvailable();
  $("guide").hidden = !guide;
  $("emptyNote").hidden = guide;
  const c = !!S.dev;
  const done = { connect: c, dark: c && darkValid(), live: S.live || !!S.frame };
  let current = null;
  for (const li of $("guideSteps").children) {
    const step = li.dataset.step;
    li.classList.toggle("done", done[step]);
    if (!done[step] && !current) current = step;
    li.classList.toggle("current", step === current);
  }
  const btn = (act) => $("guideSteps").querySelector(`[data-act="${act}"]`);
  btn("connect").disabled = S.busy || !usbAvailable();
  btn("dark").disabled = !c || S.busy || S.live;
  btn("live").disabled = !c || S.busy;
  $("guideConnectText").textContent = usbAvailable()
    ? "Plug it in over USB and choose it in the browser’s dialog."
    : "This browser cannot open USB devices — use Chrome or Edge over HTTPS.";
}

export function setDarkStatus(text, kind, short) {
  const el = $("darkStatus");
  el.textContent = text;
  el.className = `status-line ${kind}`;
  $("darkStage").textContent = short;
  $("darkDot").className = `dot ${kind}`;
}

/** Exposure as shown: milliseconds below 1 s, seconds above; trailing zeros dropped. */
export function fmtExposure(ms) {
  return ms >= 1000 ? { value: String(+(ms / 1000).toFixed(2)), unit: "s" } : { value: String(+ms.toFixed(ms < 100 ? 1 : 0)), unit: "ms" };
}

/**
 * Typed exposure in ms: "250", "250 ms", "1.5 s", "1,5s". A bare number is read in seconds only while
 * seconds are on screen and it fits the 10 s limit, so typing "200" over "2 s" means 200 ms.
 */
export function parseExposure(text) {
  const m = /^\s*(\d+(?:[.,]\d*)?|[.,]\d+)\s*(ms|s)?\s*$/i.exec(text);
  if (!m) return NaN;
  const v = parseFloat(m[1].replace(",", "."));
  const unit = m[2]?.toLowerCase() ?? ($("intUnit").textContent === "s" && v <= 10 ? "s" : "ms");
  return unit === "s" ? v * 1000 : v;
}

/** Show S.intMs in the exposure control; `force` also overwrites while the user is editing it. */
export function showExposure(force = false) {
  const input = $("intInput");
  if (!force && document.activeElement === input) return;
  const { value, unit } = fmtExposure(S.intMs);
  input.value = value;
  $("intUnit").textContent = unit;
}

// Signal levels by the strongest count as a share of full scale: [level, word, lit bars]
const SIGNAL_LEVELS = [
  [0.2, "low", "Low", 1], [0.4, "fair", "Fair", 2], [0.6, "fair", "Fair", 3], [0.9, "good", "Good", 4], [1.01, "high", "High", 5],
];

/** Signal strength of the last spectrum: bars plus a word saying whether the exposure is right. */
export function updateMeter() {
  const sig = $("meter");
  const max = S.frame?.rawMax;
  let lit = 0;
  if (max == null) {
    delete sig.dataset.level;
    $("meterText").textContent = "No data";
    $("meterPct").textContent = "";
  } else {
    const frac = clamp(max / 65535, 0, 1);
    const [, level, word, bars] = max >= SATURATION ? [0, "sat", "Saturated", 5] : SIGNAL_LEVELS.find(([lim]) => frac < lim);
    sig.dataset.level = level;
    $("meterText").textContent = word;
    $("meterPct").textContent = `${Math.round(frac * 100)} %`;
    lit = bars;
  }
  [...sig.querySelector(".sig-bars").children].forEach((bar, i) => bar.classList.toggle("on", i < lit));
  for (const li of $("sigLevels").children) li.classList.toggle("cur", li.dataset.l === sig.dataset.level);
  $("expGroup").classList.toggle("attn", S.saturated);
}

const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s` : `${+ms.toFixed(1)} ms`);

/** Values on the processing stages and what each setting costs or gains. */
export function updateChain() {
  $("avgStage").textContent = S.avg === 1 ? "1 scan" : `${S.avg} scans`;
  $("boxcarStage").textContent = S.boxcar ? `±${S.boxcar} px` : "off";
  $("jacobianSw").hidden = S.unit !== "eV";
  $("chainSum").textContent = `1 spectrum / ${fmtMs(S.avg * S.intMs)}`;

  $("avgInfo").textContent = S.avg === 1
    ? `Off — every scan is shown (${fmtMs(S.intMs)} each).`
    : `${S.avg} × ${fmtMs(S.intMs)} = ${fmtMs(S.avg * S.intMs)} per spectrum · noise × ${(1 / Math.sqrt(S.avg)).toFixed(2)}`;
  const n = S.wl?.length ?? 2068;
  const pxNm = S.wl ? Math.abs(S.wl[n - 1] - S.wl[0]) / (n - 1) : 900 / 2067;
  const win = 2 * S.boxcar + 1;
  $("boxcarInfo").textContent = S.boxcar
    ? `Window ${win} px ≈ ${(win * pxNm).toFixed(1)} nm · noise × ${(1 / Math.sqrt(win)).toFixed(2)}`
    : "Off — every pixel as measured.";

  for (const box of document.querySelectorAll(".presets[data-for]")) {
    const v = $(box.dataset.for).value;
    for (const b of box.children) b.classList.toggle("on", b.textContent === v);
  }
}

/**
 * Popovers open next to their control. Low on the screen they open above it and are anchored by their
 * bottom edge, so content that appears while open grows upwards instead of off the screen.
 */
export function initPopovers() {
  for (const pop of document.querySelectorAll("[popover]")) {
    const opener = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      opener?.setAttribute("aria-expanded", String(open));
      if (!open || !opener) return;
      const r = opener.getBoundingClientRect();
      pop.style.left = `${clamp(r.left, 8, innerWidth - pop.offsetWidth - 8)}px`;
      if (r.top > innerHeight / 2) {
        pop.style.top = "auto";
        pop.style.bottom = `${innerHeight - r.top + 8}px`;
      } else {
        pop.style.bottom = "auto";
        pop.style.top = `${r.bottom + 8}px`;
      }
    });
  }

  for (const box of document.querySelectorAll(".presets[data-for]")) {
    box.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      const input = $(box.dataset.for);
      input.value = e.target.textContent;
      input.dispatchEvent(new Event("change"));
    });
  }
}
