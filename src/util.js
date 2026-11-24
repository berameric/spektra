// Small DOM, number and storage helpers.

export const $ = (id) => document.getElementById(id);
export const fmt = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : "—");
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
export const setText = (el, v) => { if (el.textContent !== v) el.textContent = v; };

export function withAlpha(color, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** localStorage that fails quietly (private windows, blocked site data). */
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, v) { try { localStorage.setItem(key, v); } catch { /* storage unavailable */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage unavailable */ } },
};
