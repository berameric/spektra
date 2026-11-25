// One-time hint over the plot explaining the gestures, shown with the first spectrum until dismissed.

import { STORE_HINTS } from "../config.js";
import { S } from "../state.js";
import { $, store } from "../util.js";

let dismissed = store.get(STORE_HINTS) === "1";

export function initHints() {
  $("hintClose").addEventListener("click", dismissHint);
}

/** Hide the hint for good, e.g. once the user has made a selection. */
export function dismissHint() {
  if (dismissed) return;
  dismissed = true;
  store.set(STORE_HINTS, "1");
  updateHint();
}

export function updateHint() {
  $("plotHint").hidden = dismissed || !S.frame;
}
