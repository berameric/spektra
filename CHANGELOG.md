# Changelog

## 2.1.0 — 2026-11-26

### Instruments
- Instruments are recognised by their USB IDs from a table of per-model profiles. Besides the HDX, the STS,
  QE Pro, Spark and Ventana open as experimental models; older Ocean models and the Ocean ST/SR/HR series are
  recognised but not operated.
- For an instrument Spektra cannot operate, a report built from the USB descriptors alone, with a pre-filled
  GitHub issue; for an unknown device that may speak OBP, optional read-only requests.
- Read-only `?diag` page for the instrument's spectrum messages.

### Phones
- Android Chrome over a USB-C (OTG) adapter, tested with an HDX; iOS remains unsupported (no WebUSB).
- Compact landscape layout: one-line top bar, processing steps as a strip on the left, the peaks panel as a
  drawer, full-screen toggle and a prompt to turn the phone sideways.
- Touch gestures on the plot: pan, pinch-zoom, tap to select a peak, double tap to reset.

### Fixes
- The wavelength coefficients are read twice and checked, so a repeated USB reply can no longer shift them
  (the axis was stretched to about 2 × 10⁶ nm).
- X-axis labels no longer overlap when zoomed in or on narrow screens.
- Connect shows "Connecting…" and cannot be pressed twice while the instrument opens.
- Instrument error 12 is reported with its correct meaning; errors 13, 100–104 and 255 added.
- Interface text names "the spectrometer" wherever any model can be meant.

### Documentation
- `docs/PROTOCOL.md`: how Spektra communicates with the instrument.
- `docs/TROUBLESHOOTING.md`: common connection problems and their fixes (contributed by Haseem Ajaz).
- README: the project's aims, supported instruments and a call for test reports.
- `AGENTS.md` and `CONTRIBUTING.md` for contributors; issue forms, a pull request template and tests run on
  every pull request.

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
