// Instrument diagnostics, shown only with ?diag in the address. Read-only: it requests the two OBP spectrum
// messages (0x00101000, used by Spektra, and 0x00101100) twice each under the same light and compares them,
// so we can tell which one is the raw and which the corrected spectrum on this instrument. It changes no setting.

import { DIAG } from "../config.js";
import { S } from "../state.js";
import { $ } from "../util.js";
import { toast } from "./notify.js";

const PIXEL_BYTES = 2068 * 2;
const MESSAGES = [0x00101000, 0x00101100];
const hex = (v) => "0x" + v.toString(16).padStart(8, "0");

/** One reply: timing, size, the bytes before the pixel data and summary statistics of the pixels. */
async function capture(type) {
  const t0 = performance.now();
  try {
    const bytes = await S.dev.readMessage(type);
    const ms = Math.round(performance.now() - t0);
    if (bytes.length < PIXEL_BYTES) return { type: hex(type), ms, bytes: bytes.length, error: "reply shorter than 2068 pixels" };
    const v = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - PIXEL_BYTES, PIXEL_BYTES);
    const px = Array.from({ length: 2068 }, (_, i) => v.getUint16(2 * i, true));
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const meta = bytes.length - PIXEL_BYTES;
    return {
      type: hex(type), ms, bytes: bytes.length, metadataBytes: meta,
      metadataHex: Array.from(bytes.subarray(0, Math.min(meta, 64)), (b) => b.toString(16).padStart(2, "0")).join(" "),
      min: Math.min(...px), max: Math.max(...px), mean: +mean(px).toFixed(1),
      first20: +mean(px.slice(0, 20)).toFixed(1), last20: +mean(px.slice(-20)).toFixed(1),
      zeros: px.filter((x) => x === 0).length, saturated: px.filter((x) => x >= 65535).length, px,
    };
  } catch (e) {
    return { type: hex(type), ms: Math.round(performance.now() - t0), error: e.message };
  }
}

/** How two spectra differ: mean and largest difference, median ratio where the first is clearly above zero. */
function compare(a, b) {
  if (!a?.px || !b?.px) return null;
  const d = a.px.map((x, i) => b.px[i] - x);
  const ratios = a.px.map((x, i) => (x > 200 ? b.px[i] / x : null)).filter((r) => r !== null).sort((p, q) => p - q);
  return {
    meanDiff: +(d.reduce((s, x) => s + x, 0) / d.length).toFixed(1),
    meanAbsDiff: +(d.reduce((s, x) => s + Math.abs(x), 0) / d.length).toFixed(1),
    maxAbsDiff: Math.max(...d.map(Math.abs)),
    medianRatio: ratios.length ? +ratios[ratios.length >> 1].toFixed(4) : null,
  };
}

function draw(canvas, series) {
  const pr = devicePixelRatio || 1, W = canvas.clientWidth * pr, H = canvas.clientHeight * pr;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const all = series.flatMap((s) => s.px);
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  ctx.lineWidth = 1.2 * pr;
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.beginPath();
    s.px.forEach((y, i) => {
      const x = (i / (s.px.length - 1)) * W, yy = H - 4 * pr - ((y - lo) / span) * (H - 8 * pr);
      if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
    });
    ctx.stroke();
  }
}

let report = null;

async function run() {
  if (!S.dev) { toast("Connect the HDX first", "bad", 3000, "diag"); return; }
  if (S.live || S.busy) { toast("Stop Live first", "bad", 3000, "diag"); return; }
  S.busy = true;
  $("diagRun").disabled = true;
  $("diagOut").textContent = "Measuring…";
  try {
    // A B A B: the repeat of each message shows the noise between two scans of the same kind
    const caps = [];
    for (let round = 0; round < 2; round++) for (const t of MESSAGES) caps.push(await capture(t));
    const [a1, b1, a2, b2] = caps;
    report = {
      spektra: "2.0.0", time: new Date().toISOString(), model: S.dev.model, serial: S.dev.serialNumber,
      integrationMs: S.intMs, captures: caps.map(({ px, ...rest }) => rest),
      sameMessageRepeat: compare(a1, a2), otherMessageRepeat: compare(b1, b2), between: compare(a1, b1),
    };
    const rows = caps.map((c) => c.error
      ? `${c.type}  ERROR: ${c.error} (${c.ms} ms)`
      : `${c.type}  ${c.bytes} B (metadata ${c.metadataBytes} B)  ${c.ms} ms  min ${c.min}  max ${c.max}  mean ${c.mean}  first20 ${c.first20}  last20 ${c.last20}  zeros ${c.zeros}  saturated ${c.saturated}`);
    const f = (o) => (o ? `mean ${o.meanDiff}, mean |Δ| ${o.meanAbsDiff}, max |Δ| ${o.maxAbsDiff}, median ratio ${o.medianRatio}` : "n/a");
    $("diagOut").textContent = [
      ...rows, "",
      `0x00101000 vs its repeat:  ${f(report.sameMessageRepeat)}`,
      `0x00101100 vs its repeat:  ${f(report.otherMessageRepeat)}`,
      `0x00101100 − 0x00101000:   ${f(report.between)}`,
      a1.metadataHex ? `\nmetadata 0x00101000: ${a1.metadataHex}` : "",
      b1.metadataHex ? `metadata 0x00101100: ${b1.metadataHex}` : "",
    ].join("\n");
    const series = [a1, b1].filter((c) => c.px).map((c, i) => ({ px: c.px, color: i ? "#e66767" : "#ededed" }));
    if (series.length) draw($("diagPlot"), series);
    report.pixels = { "0x00101000": a1.px ?? null, "0x00101100": b1.px ?? null };
    $("diagCopy").disabled = $("diagSave").disabled = false;
  } finally {
    S.busy = false;
    $("diagRun").disabled = false;
  }
}

export function initDiag() {
  if (!DIAG) return;
  document.querySelector(".bar-right").insertAdjacentHTML("afterbegin",
    '<button class="btn" id="diagBtn" title="Instrument diagnostics (read-only)">Diagnostics</button>');
  document.body.insertAdjacentHTML("beforeend", `
<dialog id="diagDlg" class="diag">
  <h3>Spectrum message check</h3>
  <p>Read-only. Requests the spectrum with message 0x00101000 (what Spektra uses) and 0x00101100, twice each,
  under the same light, and compares them. Keep the light source steady; Live must be off.</p>
  <canvas id="diagPlot"></canvas>
  <p class="diag-legend"><span style="color:#ededed">━ 0x00101000</span> &nbsp; <span style="color:#e66767">━ 0x00101100</span></p>
  <pre id="diagOut">Press Run.</pre>
  <div class="actions">
    <button class="btn" id="diagCopy" disabled>Copy report</button>
    <button class="btn" id="diagSave" disabled>Save JSON</button>
    <div class="spacer"></div>
    <button class="btn ghost" id="diagClose">Close</button>
    <button class="btn primary" id="diagRun">Run</button>
  </div>
</dialog>`);
  $("diagBtn").addEventListener("click", () => $("diagDlg").showModal());
  $("diagClose").addEventListener("click", () => $("diagDlg").close());
  $("diagRun").addEventListener("click", run);
  $("diagCopy").addEventListener("click", async () => {
    const { pixels, ...summary } = report;
    try { await navigator.clipboard.writeText(JSON.stringify(summary, null, 2)); toast("Report copied", "ok", 2500, "diag"); }
    catch { toast("Clipboard blocked — use Save JSON", "bad", 4000, "diag"); }
  });
  $("diagSave").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(report)], { type: "application/json" }));
    a.download = `spektra-diag_${report.time.replace(/[:.]/g, "-").slice(0, 19)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
