// Light / dark theme: follows the system until the user picks one, which is remembered.

import { STORE_THEME } from "../config.js";
import { $, store } from "../util.js";

function currentTheme() {
  return document.documentElement.dataset.theme
    || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/** Apply the saved theme; `onChange` runs whenever the colours change (the plot redraws its canvas). */
export function initTheme(onChange) {
  const saved = store.get(STORE_THEME);
  if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;

  $("themeBtn").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set(STORE_THEME, next);
    onChange();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) onChange();
  });
}
