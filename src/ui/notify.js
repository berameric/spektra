// Toast notifications and the confirmation dialog.

import { $ } from "../util.js";

const toastsByKey = new Map();

/** Short notification. Toasts with the same key replace each other instead of stacking. */
export function toast(msg, kind = "info", ms = 4500, key = null) {
  let d = key && toastsByKey.get(key);
  if (!d) {
    d = document.createElement("div");
    $("toasts").append(d);
    if (key) toastsByKey.set(key, d);
  }
  d.className = `toast ${kind}`;
  d.textContent = msg;
  clearTimeout(d.timer);
  d.timer = setTimeout(() => {
    if (key) toastsByKey.delete(key);
    d.classList.add("out");
    setTimeout(() => d.remove(), 300);
  }, ms);
}

/** Whether the toast with this key is still shown with the given kind. */
export const toastShowing = (key, kind) => !!toastsByKey.get(key)?.classList.contains(kind);

export function confirmDialog(title, text) {
  const d = $("dlg");
  $("dlgTitle").textContent = title;
  $("dlgText").textContent = text;
  d.returnValue = "";
  d.showModal();
  return new Promise((resolve) => d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true }));
}
