// Start-up system check: detects the OS and browser and explains what is still needed to reach the HDX.

import { STORE_ENV } from "../config.js";
import { HDXUSB } from "../device/hdx-usb.js";
import { $, store } from "../util.js";

function detectPlatform() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows"
    : /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "iOS"
      : /Macintosh|Mac OS X/.test(ua) ? "macOS"
        : /Android/.test(ua) ? "Android"
          : /CrOS/.test(ua) ? "ChromeOS"
            : /Linux|X11/.test(ua) ? "Linux" : "an unknown system";
  const browser = /Edg\//.test(ua) ? "Microsoft Edge" : /OPR\//.test(ua) ? "Opera"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Google Chrome"
      : /Safari\//.test(ua) ? "Safari" : "This browser";
  return { os, browser };
}

/** What this computer and browser still need before the HDX can be used. */
function environmentNotes({ os, browser }) {
  const notes = [];
  if (os === "iOS" || os === "Android") {
    notes.push({
      level: "block", title: "Use a desktop or laptop computer",
      html: `<p>The HDX connects over USB to a computer. ${os} browsers cannot open USB devices from a web page.</p>`,
    });
  } else if (!HDXUSB.supported()) {
    notes.push({
      level: "block", title: `${browser} cannot open USB devices`,
      html: "<p>This page talks to the spectrometer through WebUSB, which only Chromium-based browsers provide. "
        + "Open it in <b>Google Chrome</b> or <b>Microsoft Edge</b>.</p>",
    });
  }
  if (!window.isSecureContext) {
    notes.push({
      level: "block", title: "Open the page over HTTPS",
      html: "<p>WebUSB works only on <code>https://</code> pages or on <code>http://localhost</code>. "
        + "Use the published HTTPS address, or serve the folder locally.</p>",
    });
  }
  if (os === "Windows") {
    notes.push({
      level: "setup", title: "Windows: install the WinUSB driver once",
      html: "<ol><li>Plug in the HDX and run <a href=\"https://zadig.akeo.ie\" target=\"_blank\" rel=\"noopener\">Zadig</a> (no installation needed).</li>"
        + "<li>Choose <i>Options → List All Devices</i> and select the HDX (USB ID <code>2457</code> <code>2003</code>).</li>"
        + "<li>Select <b>WinUSB</b> as the driver and press <i>Replace Driver</i> or <i>Install Driver</i>.</li></ol>"
        + "<p>Needed once per computer. Afterwards OceanView no longer sees the HDX until its driver is restored in Device Manager.</p>",
    });
  }
  if (os === "Linux") {
    notes.push({
      level: "setup", title: "Linux: allow USB access once",
      html: "<p>Create <code>/etc/udev/rules.d/99-ocean-hdx.rules</code> with:</p>"
        + "<pre>SUBSYSTEM==\"usb\", ATTR{idVendor}==\"2457\", ATTR{idProduct}==\"2003\", MODE=\"0666\"</pre>"
        + "<p>then run <code>sudo udevadm control --reload-rules &amp;&amp; sudo udevadm trigger</code> and replug the HDX.</p>",
    });
  }
  return notes;
}

/** On start: explain what is missing; `force` also opens it when everything is ready (from the help). */
export function checkEnvironment(force = false) {
  const env = detectPlatform();
  const notes = environmentNotes(env);
  const blocking = notes.some((n) => n.level === "block");
  if (!force && (!notes.length || (!blocking && store.get(STORE_ENV) === "1"))) return;
  $("envSystem").textContent = `${env.browser} on ${env.os}`;
  $("envList").innerHTML = notes.length
    ? notes.map((n) => `<li class="env-${n.level}"><h4>${n.title}</h4>${n.html}</li>`).join("")
    : "<li class=\"env-ready\"><h4>Ready</h4><p>This browser supports WebUSB and this system needs no driver. Plug in the HDX and press Connect.</p></li>";
  $("envTitle").textContent = blocking ? "This browser cannot connect to the HDX" : notes.length ? "Before you connect" : "System check";
  $("envHideRow").hidden = blocking || !notes.length;
  $("envDlg").showModal();
}

export function initEnvironment() {
  $("envDlg").addEventListener("close", () => {
    if ($("envHide").checked) store.set(STORE_ENV, "1");
  });
  $("envOpen").addEventListener("click", () => { $("helpPop").hidePopover(); checkEnvironment(true); });
}
