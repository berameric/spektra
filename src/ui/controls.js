// Control states: top bar buttons, dark status, signal-chain stage values and the popovers that set them.

import { HDXUSB } from "../device/hdx-usb.js";
import { S, darkValid } from "../state.js";
import { $, clamp } from "../util.js";

export function updateUi() {
  const c = !!S.dev, usb = HDXUSB.supported() && window.isSecureContext;
  $("connectLabel").textContent = c ? "Disconnect" : "Connect HDX";
  $("connectBtn").classList.toggle("primary", !c);
  $("connectBtn").disabled = S.busy || (!c && !usb);
  $("led").className = `led${c ? " on" : ""}${S.live ? " live" : ""}`;
  $("devInfo").textContent = c ? `${S.dev.model} · S/N ${S.dev.serialNumber}` : "Not connected";
  $("acqBtn").disabled = !c || S.live || S.busy;
  $("liveBtn").disabled = !c || S.busy;
  $("liveLabel").textContent = S.live ? "Stop" : "Live";
  $("liveBtn").classList.toggle("stop", S.live);
  $("liveBtn").classList.toggle("primary", !S.live);
  $("darkBtn").disabled = !c || S.live || S.busy;
  $("darkClear").disabled = S.dark === null || S.busy;
  $("csvBtn").disabled = !S.frame;
  for (const id of ["intInput", "intUp", "intDown"]) $(id).disabled = S.autoInt;
  if (!S.measuringDark) {
    if (S.dark === null) setDarkStatus("No dark taken — raw counts are shown.", "warn", "none");
    else if (!darkValid()) setDarkStatus(`Taken at ${S.darkIntMs} ms, exposure is now ${S.intMs} ms — retake it.`, "bad", "retake");
    else if (!S.subtractDark) setDarkStatus(`Valid (${S.darkIntMs} ms) but not subtracted.`, "warn", "off");
    else setDarkStatus(`Subtracting the dark taken at ${S.darkIntMs} ms.`, "ok", "subtracted");
  }
  updateChain();
  if (!S.live) $("scanInfo").textContent = "";
}

export function setDarkStatus(text, kind, short) {
  const el = $("darkStatus");
  el.textContent = text;
  el.className = `status-line ${kind}`;
  $("darkStage").textContent = short;
  $("darkDot").className = `dot ${kind}`;
}

/** Values shown on the signal-chain stages. */
export function updateChain() {
  $("avgStage").textContent = S.avg === 1 ? "1 scan" : `${S.avg} scans`;
  $("boxcarStage").textContent = S.boxcar ? `±${S.boxcar} px` : "off";
  const eV = S.unit === "eV";
  $("displayStage").textContent = `${S.unit}${eV && S.jacobian ? " /meV" : ""} · ${$("autoY").checked ? "auto Y" : "fixed Y"}`;
  $("jacobianRow").hidden = $("jacobianNote").hidden = !eV;
  for (const box of document.querySelectorAll(".presets")) {
    const v = $(box.dataset.for).value;
    for (const b of box.children) b.classList.toggle("on", b.textContent === v);
  }
}

/** Popovers open next to their control (above it when it sits low); preset buttons fill their input. */
export function initPopovers() {
  for (const pop of document.querySelectorAll("[popover]")) {
    const opener = document.querySelector(`[popovertarget="${pop.id}"]`);
    pop.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      opener?.setAttribute("aria-expanded", String(open));
      if (!open || !opener) return;
      const r = opener.getBoundingClientRect();
      const w = pop.offsetWidth, h = pop.offsetHeight;
      pop.style.left = `${clamp(r.left, 8, innerWidth - w - 8)}px`;
      pop.style.top = `${r.top > innerHeight / 2 ? r.top - h - 8 : r.bottom + 8}px`;
    });
  }

  for (const box of document.querySelectorAll(".presets")) {
    box.addEventListener("click", (e) => {
      if (e.target.tagName !== "BUTTON") return;
      const input = $(box.dataset.for);
      input.value = e.target.textContent;
      input.dispatchEvent(new Event("change"));
    });
  }
}
