# AGENTS.md

Guidance for AI coding agents (and people) changing Spektra. Read it before editing; follow the code
around you where this file is silent.

## What this is

A static web app that drives an Ocean Insight HDX spectrometer over WebUSB. No server, no build, no
install: the repository root is the site (GitHub Pages serves `main` as is).

## Hard rules

- **No build step, no dependencies.** Plain ES modules loaded by the browser. Do not add npm packages,
  bundlers, TypeScript, JSX or frameworks. The only third-party code is `vendor/uplot/` (vendored, MIT).
- **JavaScript, not TypeScript.** Types live in names and short JSDoc comments (`/** … */`) on exported or
  non-obvious functions. Do not add `.ts` files or type-only tooling.
- **Analysis stays pure.** `src/analysis/` has no DOM access and runs in Node; keep it that way and cover
  changes with `tests/test_web_analysis.mjs`.
- **Do not claim hardware support you have not tested.** Only the HDX is verified. Other models go in as
  clearly marked experimental profiles (see CONTRIBUTING.md).
- **The simulated HDX is development only.** `src/device/mock-hdx.js` loads only on `localhost` with `?mock`
  (`MOCK` in `config.js`); never make it reachable on the published site.

## Layout

| Path | Responsibility |
|---|---|
| `index.html` | Markup only; every interactive element has an `id` used by the modules |
| `src/main.js` | Entry point: wires controls to actions, keyboard shortcuts, start-up |
| `src/state.js` | The shared state object `S` and display-unit helpers |
| `src/config.js` | Constants, storage keys, peak colours (read from CSS tokens), `MOCK` |
| `src/acquisition.js` | Connect, acquire, live loop, exposure, dark |
| `src/spectrum.js` | Frame → display unit, peak detection, render scheduling (one render per frame) |
| `src/export.js` | CSV and PNG export |
| `src/device/` | `hdx-usb.js` (WebUSB + Ocean Binary Protocol), `mock-hdx.js` (same interface) |
| `src/analysis/peaks.js` | Baseline, peak finding, FWHM, area, Jacobian energy conversion |
| `src/ui/` | One module per surface: `plot`, `plot-overlays`, `overview`, `peaks`, `rail`, `controls`, `notify`, `environment`, `hints` |
| `src/styles/spektra.css` | All styles; design tokens on `:root` |
| `tests/` | Node tests, no dependencies |

Keep this shape: a new feature gets its own module rather than growing `main.js`. Avoid import cycles;
pass callbacks (as `initPlot(handlers)` does) when a lower module must reach a higher one.

## Code style

- 2-space indent, double quotes, semicolons, `const` by default, lines up to about 120 characters.
- Comments explain *why* or the non-obvious *what*, in full sentences; each module starts with a one-line
  header saying what it is for. No commented-out code.
- DOM access through `$("id")` from `util.js`; `localStorage` only through `store` (it fails quietly).
- State lives in `S`; modules read it and call the update functions instead of keeping private copies.
- User-facing text is English, short, and says what happened or what to do next.
- Notifications use `toast(msg, kind, ms, key)`; reuse a key so repeated events replace each other.

## Interface rules

- **Dark only.** Colours come from the CSS tokens on `:root`; do not hard-code new colours in components.
- Controls are monochrome. **Orange (`--hl`) marks only the selected range** on the plot.
- Peak colours are the tokens `--pk-1 … --pk-7`, chosen and checked for colour-vision deficiency as a
  cycle in wavelength order. Change the order or values only after re-validating them.
- State colours (`--ok`, `--warn`, `--bad`, `--live`) carry state, never decoration.
- New controls follow the existing vocabulary: `.btn`, `.switch`, `.seg`, popovers via the `popover` attribute.

## Plot (uPlot) pitfalls already paid for

- uPlot applies scale changes later. **Change the visible X range only through `setX()`** in `plot.js`,
  which passes the new window to the Y fit explicitly.
- uPlot leaves the last series' dash pattern on the canvas; overlay drawing resets it with `setLineDash([])`.
- A log axis passes `null` for unlabelled ticks; tick formatters must pass `null` through.

## Before you finish

1. `npm test` passes.
2. `npm start`, open `http://localhost:8000/?mock`, and exercise what you changed: connect, Live, the
   feature itself. Check the browser console for errors.
3. Commits: a short imperative subject line, then a body that says what changed and why.
