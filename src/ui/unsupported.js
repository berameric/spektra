// Dialog for an Ocean instrument without a supported profile: says what it is, collects a report (USB
// descriptors; optionally read-only OBP requests) and opens a pre-filled GitHub issue. Nothing is sent
// anywhere automatically: the user reviews the issue and submits it.

import { OBP2, OOI, PROTOCOL_NAMES } from "../device/profiles.js";
import { describeDevice, probeObp } from "../device/probe.js";
import { $ } from "../util.js";
import { toast } from "./notify.js";

const ISSUES = "https://github.com/berameric/spektra/issues/new";
let current = null; // { device, profile, report }

function build() {
  document.body.insertAdjacentHTML("beforeend", `
<dialog id="unsupDlg" class="diag">
  <h3 id="unsupTitle"></h3>
  <p id="unsupText"></p>
  <pre id="unsupReport"></pre>
  <p id="unsupProbeNote"></p>
  <div class="actions">
    <button class="btn" id="unsupProbe">Run read-only OBP checks</button>
    <button class="btn" id="unsupCopy">Copy report</button>
    <div class="spacer"></div>
    <button class="btn ghost" id="unsupClose">Close</button>
    <a class="btn primary" id="unsupIssue" target="_blank" rel="noopener">Open a GitHub issue</a>
  </div>
</dialog>`);
  $("unsupClose").addEventListener("click", () => $("unsupDlg").close());
  $("unsupCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(reportText()); toast("Report copied", "ok", 2500, "unsup"); }
    catch { toast("Clipboard blocked — select the text and copy it", "bad", 4000, "unsup"); }
  });
  $("unsupProbe").addEventListener("click", async () => {
    $("unsupProbe").disabled = true;
    $("unsupProbeNote").textContent = "Asking the instrument…";
    current.report.obpChecks = await probeObp(current.device);
    $("unsupProbeNote").textContent = "Done. The results are added to the report.";
    render();
  });
}

const reportText = () => JSON.stringify(current.report, null, 2);

function render() {
  $("unsupReport").textContent = reportText();
  const title = `Instrument report: ${current.report.device.knownAs ?? `${current.report.device.productName ?? "unknown"} ${current.report.device.productId}`}`;
  const body = `**Instrument:** (model, and firmware version if known)\n\n**What happened:**\n\n**Report from Spektra:**\n\`\`\`json\n${reportText()}\n\`\`\`\n`;
  $("unsupIssue").href = `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}&labels=${encodeURIComponent("instrument support")}`;
}

/** Show the dialog for `device` (a USBDevice); `profile` is its table entry if the model is recognised. */
export function showUnsupported(device, profile) {
  if (!$("unsupDlg")) build();
  current = {
    device, profile,
    report: { spektra: "2.0.0", time: new Date().toISOString(), browser: navigator.userAgent, device: describeDevice(device) },
  };
  const known = profile && profile.protocol !== undefined;
  $("unsupTitle").textContent = known ? `${profile.model} is not supported yet` : "This instrument is not supported yet";
  $("unsupText").textContent = known
    ? `The ${profile.model} uses the ${PROTOCOL_NAMES[profile.protocol]}, which Spektra does not implement yet. A report helps to add it: open a GitHub issue with the report below (you can check it before submitting).`
    : "Spektra does not know this Ocean Insight model yet. A report helps to add it: open a GitHub issue with the report below (you can check it before submitting).";
  // OBP requests are safe only for instruments that may speak OBP; a legacy or OBP2 instrument could take the
  // bytes for commands, so the checks are not offered for those.
  const risky = profile && (profile.protocol === OOI || profile.protocol === OBP2);
  $("unsupProbe").hidden = risky;
  $("unsupProbe").disabled = false;
  $("unsupProbeNote").textContent = risky ? "" : "Optional: the OBP checks only read (serial number, calibration and spectrum requests); they change no setting on the instrument.";
  render();
  $("unsupDlg").showModal();
}
