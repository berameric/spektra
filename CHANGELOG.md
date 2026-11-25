# Changelog

## 2.0.0 — 2026-11-25

Spektra 2.0 replaces the earlier desktop program (1.x, Python and Qt) with a browser application:
nothing to install, the HDX is reached directly over WebUSB.

### Acquisition
- Connect, single Acquire and continuous Live; averaging, dark subtraction, boxcar smoothing.
- Exposure control with typed values, scroll and arrow keys; Auto exposure keeps the strongest peak at
  60–90 % of full scale.
- Signal strength shown as Low · Fair · Good · High · Saturated.

### Analysis
- Automatic peak detection over the whole spectrum or a selected range; sub-pixel position, FWHM,
  height, area and SNR.
- Photon-energy axis with Jacobian conversion to counts per meV (on by default).

### Plot
- Measured FWHM and a value label on the highlighted peak; saturation limit and clipped pixels.
- Held reference curve, log intensity axis, overview strip while zoomed, zoom to a peak or selection.

### Peaks panel
- Sortable table with relative heights; rows and plot dots highlight each other; click to zoom.
- Copy to a spreadsheet; resizable and collapsible panel.

### Export
- Spectrum and peaks as CSV with acquisition metadata; the plot as PNG.

### Interface
- Dark interface; colour-vision-checked peak palette; keyboard shortcuts.
- Start-up system check (OS, browser, driver) and a first-run guide.

### Development
- Simulated HDX at `http://localhost:8000/?mock`; no-cache development server.
