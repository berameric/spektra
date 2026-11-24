# Spektra

**Spektra** is browser-based acquisition and line-analysis software for the **Ocean Insight HDX** compact
spectrometer, developed at the **Nano Optoelectronics Laboratories, Istanbul University**
(İstanbul Üniversitesi Nano Optoelektronik Laboratuvarları).

Spektra runs entirely in the browser and talks to the spectrometer over **WebUSB**: nothing is installed.
Open the page, press **Connect HDX**, choose the instrument in the browser's device dialog and press **Live**.

## Supported hardware

| Property | Value |
|---|---|
| Instrument | Ocean Insight **HDX** spectrometer (operated without a monochromator) |
| USB identifiers | vendor `0x2457`, product `0x2003` |
| Detector | 2068 pixels, 16-bit counts (saturation reported from 65 000 counts) |
| Exposure | 6 ms – 10 s |
| Protocol | Ocean Binary Protocol (OBP) over USB bulk endpoints `0x01` / `0x81` |
| Wavelength axis | polynomial from the calibration coefficients stored in the instrument |

Other Ocean Insight models are not supported.

## Requirements

| | Requirement |
|---|---|
| Browser | **Google Chrome** or **Microsoft Edge** on a desktop or laptop. Firefox, Safari and mobile browsers do not provide WebUSB. |
| Address | an `https://` page (e.g. GitHub Pages) or `http://localhost`. WebUSB is disabled on plain `http://`. |
| Windows | the HDX must use the **WinUSB** driver — see below. |
| Linux | a udev rule granting access to the device — see below. |
| macOS, ChromeOS | no additional setup. |

When the page opens it detects the operating system and browser and lists whatever is still missing.
The same check is available later from **? → System check…** above the plot.

### Windows: WinUSB driver (once per computer)

Chrome and Edge can open a USB device only when Windows has bound it to the generic **WinUSB** driver.
Whether or not OceanView is installed, this has to be done once:

1. Plug in the HDX and run [Zadig](https://zadig.akeo.ie) (a portable executable, no installation).
2. Choose **Options → List All Devices** and select the HDX (USB ID `2457 2003`).
3. Select **WinUSB** as the target driver and press **Replace Driver** (or **Install Driver**).

Afterwards OceanView no longer sees the instrument. To return it to OceanView, open Device Manager,
uninstall the HDX device together with its driver and replug it.

### Linux: USB permission (once per computer)

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2457", ATTR{idProduct}=="2003", MODE="0666"' \
  | sudo tee /etc/udev/rules.d/99-ocean-hdx.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Replug the HDX afterwards.

## Using the interface

| Area | Contents |
|---|---|
| Top bar | connection, **Acquire** (single spectrum), **Live**, exposure with optional **Auto** (keeps the strongest line near 80 % of full scale), **Export** |
| Plot | spectrum in wavelength (nm) or photon energy (eV); drag to select a range, click a peak to select the whole peak, drag the selection edges, wheel to zoom, Shift + drag to pan, double-click to reset |
| Peaks panel | **Detect** switch; peaks of the selected range, or of the whole spectrum when nothing is selected, colour-coded on the plot and in the list |
| Signal chain | **Average** (scans per spectrum) › **Dark** (background measurement and subtraction) › **Boxcar** (smoothing) › **Display** (axis unit, Y scaling) |

Every action reports its result in a short notification (spectrum acquired, exposure changed, file saved,
detector saturated, …).

## Analysis method

1. **Pre-processing.** Optional averaging of *N* scans, subtraction of a dark spectrum recorded at the same
   exposure, optional boxcar smoothing over 2*w* + 1 pixels.
2. **Baseline and noise.** The baseline is the median of the lowest 30 % of pixel values; the noise σ is
   1.4826 × the median absolute deviation of those pixels (a robust estimate for line spectra).
3. **Peak detection.** On the baseline-corrected, 3-point median-filtered signal, local maxima are kept when
   both their height and their topographic prominence exceed max(5 σ, 1 % of the strongest line in the
   searched range), with a minimum separation of 2 nm (the `scipy.signal.find_peaks` criteria). The search
   is limited to the selected range when one is set.
4. **Line position.** Sub-pixel centre from a parabola through the logarithm of the three highest samples,
   which is exact for a Gaussian line profile.
5. **Width and area.** FWHM from linear interpolation of the two half-maximum crossings; integrated
   intensity by the trapezoidal rule within ±1.5 FWHM of the centre.
6. **Photon energy.** *E* = *hc* / λ with *hc* = 1239.841 984 eV·nm (CODATA 2018); the FWHM in eV is the
   difference of the energies of the two half-maximum crossings.
7. **Signal-to-noise ratio.** Baseline-corrected peak height divided by σ.

### Exported files

CSV files start with `#` comment lines recording the acquisition time, instrument and serial number,
exposure, number of averaged scans, boxcar width and whether a dark spectrum was subtracted.

* **Spectrum:** `wavelength_nm, energy_ev, intensity`
* **Peaks:** `peak, wavelength_nm, energy_ev, fwhm_nm, fwhm_ev, counts, area, snr, strongest`, plus the
  searched range and the detection criteria in the header.

## Running locally

There is no build step: the repository root is the site.

```bash
npm start      # = python3 -m http.server 8000; then open http://localhost:8000 in Chrome or Edge
```

Any static file server works; `localhost` counts as a secure origin, so WebUSB is available.
For GitHub Pages, publish the `main` branch from the repository root (`/`).

## Repository layout

```
index.html              page markup
src/
  main.js               entry point: wires the controls to the modules
  config.js             instrument limits, detection criteria, colours
  state.js              application state, display-unit conversion
  util.js               DOM, number and storage helpers
  acquisition.js        connect, acquire, live view, exposure, dark measurement
  spectrum.js           frame → display unit, peak detection in the selection, rendering
  export.js             CSV export with metadata
  device/hdx-usb.js     WebUSB driver for the HDX (Ocean Binary Protocol)
  analysis/peaks.js     peak analysis (no DOM; tested in Node)
  ui/plot.js            spectrum plot, overlays and mouse gestures
  ui/peaks.js           peaks list and selection display
  ui/controls.js        button states, signal chain, popovers
  ui/notify.js          notifications and confirmation dialog
  ui/environment.js     start-up system check (OS, browser, drivers)
  ui/theme.js           light / dark theme
  styles/spektra.css    styles
vendor/uplot/           uPlot 1.6.32 (MIT licence)
tests/                  Node tests (no dependencies)
```

## Tests

Requires Node.js 18 or newer; no packages to install.

```bash
npm test
# or individually:
node tests/test_web_analysis.mjs   # peak analysis against reference spectra
node tests/test_web_usb.mjs        # WebUSB driver against an emulated OBP device
```

## Acknowledgement

Spektra was developed at the Nano Optoelectronics Laboratories, Istanbul University.
Plotting uses [uPlot](https://github.com/leeoniya/uPlot) by Leon Sorokin (MIT licence).
