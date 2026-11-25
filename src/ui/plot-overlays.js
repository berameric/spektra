// Drawing on top of the uPlot canvas: the visible-spectrum strip, the selected range, the saturation limit
// with clipped pixels, and the peak dots. The highlighted peak (hovered, or clicked in the table) also gets
// its FWHM drawn at half maximum and a label with its position, width and height.

import { peakColor } from "../config.js";
import { S, dispRange, fromDisp, perMev, satLevel, toDisp } from "../state.js";
import { fmt, withAlpha } from "../util.js";

/** Approximate colour of a wavelength: visible 380–750 nm fading to black at both ends; black outside (UV, IR). */
export function wavelengthColor(nm) {
  if (!(nm >= 380 && nm <= 750)) return Number.isFinite(nm) ? "#000" : null;
  let r = 0, g = 0, b = 0;
  if (nm < 440) { r = (440 - nm) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
  else r = 1;
  const edge = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (750 - nm)) / 50 : 1;
  return `rgb(${Math.round(255 * r * edge)}, ${Math.round(255 * g * edge)}, ${Math.round(255 * b * edge)})`;
}

/** Displayed intensity of detector pixel i (the eV axis with the Jacobian shows counts per meV). */
function dispY(i) {
  const v = perMev() ? (S.frame.inten[i] - S.disp.offset) * S.disp.factor[i] : S.frame.inten[i];
  return S.logY ? Math.max(v, 1) : v;
}

export function drawOverlays(u, C) {
  const ctx = u.ctx, bbox = u.bbox, pr = uPlot.pxRatio;
  const X = (v) => u.valToPos(v, "x", true);
  const Y = (v) => u.valToPos(S.logY ? Math.max(v, 1) : v, "y", true);
  ctx.save();
  ctx.setLineDash([]); // uPlot leaves the reference curve's dash pattern set
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();

  // Spectrum strip along the bottom edge: where in the spectrum the view is (UV and IR black)
  const strip = 5 * pr, step = 2 * pr;
  for (let px = bbox.left; px < bbox.left + bbox.width; px += step) {
    const col = wavelengthColor(fromDisp(u.posToVal((px - bbox.left) / pr, "x")));
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.fillRect(px, bbox.top + bbox.height - strip, step + 0.5, strip);
  }

  // Selected range
  if (S.sel) {
    const [a, b] = dispRange(S.sel.lo, S.sel.hi);
    const x1 = X(a), x2 = X(b);
    ctx.fillStyle = withAlpha(C.hl, 0.08);
    ctx.fillRect(x1, bbox.top, x2 - x1, bbox.height);
    ctx.strokeStyle = C.hl;
    ctx.lineWidth = 1.5 * pr;
    ctx.beginPath();
    ctx.moveTo(x1, bbox.top); ctx.lineTo(x1, bbox.top + bbox.height);
    ctx.moveTo(x2, bbox.top); ctx.lineTo(x2, bbox.top + bbox.height);
    ctx.stroke();
  }

  if (S.frame) drawSaturation(u, ctx, C, X, Y, pr);

  // Detected peaks: colour-coded dots; the highlighted one is measured on the plot
  const shown = S.hoverPeak >= 0 ? S.hoverPeak : S.focusPeak;
  S.peaks.forEach((p, i) => {
    const px = X(toDisp(p.measuredPeak)), py = Y(p.rawIntensity);
    if (i === S.hoverPeak || i === S.focusPeak) {
      ctx.strokeStyle = peakColor(i);
      ctx.lineWidth = 2 * pr;
      ctx.beginPath();
      ctx.arc(px, py, 10 * pr, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (i === shown) drawMeasurement(ctx, C, X, Y, pr, bbox, p, i, px, py);
    ctx.beginPath();
    ctx.arc(px, py, (i === S.mainPeak ? 6 : 4.5) * pr, 0, 2 * Math.PI);
    ctx.fillStyle = peakColor(i);
    ctx.fill();
    ctx.lineWidth = 1.5 * pr;
    ctx.strokeStyle = C.panel;
    ctx.stroke();
  });
  ctx.restore();
}

/** Dashed limit at full scale and the clipped pixels of the curve in red. */
function drawSaturation(u, ctx, C, X, Y, pr) {
  const { wl, raw, meta } = S.frame;
  const bbox = u.bbox;
  if (!perMev()) {
    // A subtracted dark lowers the level at which the shown spectrum clips
    let level = satLevel();
    if (meta.darkMs !== null && S.dark) level -= S.dark.reduce((s, v) => s + v, 0) / S.dark.length;
    const ly = Y(level);
    if (ly >= bbox.top && ly <= bbox.top + bbox.height) {
      ctx.strokeStyle = withAlpha(C.bad, 0.7);
      ctx.lineWidth = 1 * pr;
      ctx.setLineDash([6 * pr, 4 * pr]);
      ctx.beginPath();
      ctx.moveTo(bbox.left, ly); ctx.lineTo(bbox.left + bbox.width, ly);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `${10.5 * pr}px ${C.font}`;
      ctx.fillStyle = C.bad;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillText("Saturation", bbox.left + bbox.width - 6 * pr, ly - 3 * pr);
    }
  }
  // Runs of clipped pixels, drawn over the curve
  ctx.strokeStyle = C.bad;
  ctx.lineWidth = 3 * pr;
  ctx.lineCap = "round";
  ctx.beginPath();
  let open = false;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] >= satLevel()) {
      const x = X(toDisp(wl[i])), y = Y(dispY(i));
      if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y); open = true; }
    } else open = false;
  }
  ctx.stroke();
  ctx.lineCap = "butt";
}

/** FWHM at half maximum and a label next to the highlighted peak. */
function drawMeasurement(ctx, C, X, Y, pr, bbox, p, i, px, py) {
  const color = peakColor(i);
  if (Number.isFinite(p.loNm) && Number.isFinite(p.hiNm)) {
    const hy = Y(p.rawIntensity - p.peakIntensity / 2);
    const xa = X(toDisp(p.loNm)), xb = X(toDisp(p.hiNm));
    const [x1, x2] = xa < xb ? [xa, xb] : [xb, xa];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * pr;
    ctx.beginPath();
    ctx.moveTo(x1, hy); ctx.lineTo(x2, hy);
    ctx.moveTo(x1, hy - 4 * pr); ctx.lineTo(x1, hy + 4 * pr);
    ctx.moveTo(x2, hy - 4 * pr); ctx.lineTo(x2, hy + 4 * pr);
    ctx.stroke();
  }

  const eV = S.unit === "eV";
  const line1 = eV ? `${fmt(p.energyEv, 4)} eV` : `${fmt(p.measuredPeak, 2)} nm`;
  const fwhm = eV ? `${fmt(p.fwhmEv * 1000, 1)} meV` : `${fmt(p.fwhmNm, 2)} nm`;
  const line2 = `FWHM ${fwhm} · ${p.rawIntensity.toFixed(0)} ${perMev() ? "cts/meV" : "cts"}`;
  const f1 = `600 ${12 * pr}px ${C.mono}`, f2 = `${10.5 * pr}px ${C.mono}`;
  ctx.font = f1;
  const w1 = ctx.measureText(line1).width;
  ctx.font = f2;
  const w2 = ctx.measureText(line2).width;
  const pad = 7 * pr, w = Math.max(w1, w2) + 2 * pad + 12 * pr, h = 36 * pr;
  let lx = px + 16 * pr;
  if (lx + w > bbox.left + bbox.width - 4 * pr) lx = px - 16 * pr - w;
  const ly = Math.min(Math.max(py - h / 2, bbox.top + 4 * pr), bbox.top + bbox.height - h - 10 * pr);

  ctx.fillStyle = C.panel;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1 * pr;
  ctx.beginPath();
  ctx.roundRect(lx, ly, w, h, 7 * pr);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(lx + pad + 4 * pr, ly + 12 * pr, 4 * pr, 0, 2 * Math.PI);
  ctx.fill();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.text;
  ctx.font = f1;
  ctx.fillText(line1, lx + pad + 12 * pr, ly + 12 * pr);
  ctx.fillStyle = C.muted;
  ctx.font = f2;
  ctx.fillText(line2, lx + pad, ly + 26 * pr);
}
