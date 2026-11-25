// Phones: a compact landscape layout. Touch devices whose short side is at most 600 px get the "compact"
// class; held upright they get "portrait", which shows the turn-sideways screen. Full screen also locks
// the orientation to landscape (Android Chrome allows the lock only in full screen).

import { $ } from "../util.js";

const root = document.documentElement;

/** A phone: touch first and a small screen, whichever way it is held. */
export const isCompact = () => matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 600;

function update() {
  root.classList.toggle("compact", isCompact());
  root.classList.toggle("portrait", innerHeight > innerWidth);
  $("fsIcon").setAttribute("href", document.fullscreenElement ? "#i-minimize" : "#i-maximize");
}

async function enterLandscape() {
  try {
    if (!document.fullscreenElement) await root.requestFullscreen({ navigationUI: "hide" });
    await screen.orientation?.lock?.("landscape");
  } catch {
    // Full screen or the lock was refused (e.g. iOS, desktop); turning the phone still works
  }
}

/** `onCompact()` runs once when the compact layout first applies (e.g. to fold away side panels). */
export function initMobile(onCompact) {
  update();
  if (isCompact()) onCompact();
  addEventListener("resize", update);
  document.addEventListener("fullscreenchange", update);
  $("rotateFs").addEventListener("click", enterLandscape);
  $("fsBtn").addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : enterLandscape()));
}
