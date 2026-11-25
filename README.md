# Spektra

**Run the Ocean Insight HDX spectrometer from a web page — on any computer, and even on an Android phone.**

Open the page, plug in the instrument, measure. Nothing to install and no licence: Spektra talks to the HDX
directly from the browser over USB.

[![Open Spektra](https://img.shields.io/badge/Open%20Spektra-berameric.github.io%2Fspektra-111?style=for-the-badge)](https://berameric.github.io/spektra/)
[![Version 2.0.0](https://img.shields.io/badge/version-2.0.0-555?style=for-the-badge)](CHANGELOG.md)
[![MIT licence](https://img.shields.io/badge/licence-MIT-555?style=for-the-badge)](LICENSE)

![Spektra on a computer: live spectrum with detected peaks and the peak table (simulated data)](assets/screenshot.png)

## Why Spektra

- **Nothing to install.** It is a web page. Open it in Chrome or Edge and press *Connect HDX*.
- **Any device.** Windows, macOS, Linux, ChromeOS — and Android phones and tablets over a USB-C adapter.
- **Made for measuring.** Live view, automatic exposure, dark subtraction, averaging and automatic peak
  detection with position, FWHM, height and area, in wavelength or photon energy.
- **Your data, your files.** Export spectra and peak tables as CSV with full acquisition metadata, or the
  plot as an image. Nothing leaves your computer.
- **Open source.** MIT licensed, no dependencies, easy to read and to extend.

### Even on a phone

The same page on an Android phone, measuring a real lamp spectrum with the HDX over a USB-C adapter:

![Spektra on an Android phone in landscape, live spectrum from a real HDX](assets/android-hdx.png)

## Getting started

1. Open **[berameric.github.io/spektra](https://berameric.github.io/spektra/)** in Google Chrome or Microsoft Edge.
2. Plug in the HDX and press **Connect HDX**; choose the HDX in the browser's device dialog.
3. Press **Live**.

On first start Spektra checks your system and says if anything is still missing (see below).

## What it does

| | |
|---|---|
| **Acquisition** | Single spectrum or continuous live view · exposure 6 ms – 10 s, typed, stepped or automatic · averaging · dark background measurement and subtraction · boxcar smoothing |
| **Signal** | Signal strength shown as Low · Fair · Good · High · Saturated · saturation limit and clipped pixels marked on the plot |
| **Peaks** | Automatic detection over the whole spectrum or a selected range · sub-pixel position, FWHM, height, area, SNR · sortable table, click a peak to zoom to it |
| **Axes** | Wavelength (nm) or photon energy (eV) with Jacobian conversion to counts/meV · linear or log intensity |
| **Plot** | Zoom and pan with mouse, wheel or touch · select a range by dragging, or a whole peak by clicking or tapping it · held reference curve · overview strip |
| **Export** | Spectrum and peaks as CSV with metadata · plot as PNG · peak table to the clipboard |

## Platform setup

| Platform | What is needed |
|---|---|
| macOS, ChromeOS | Nothing |
| Windows | The WinUSB driver, once per computer |
| Linux | A udev rule, once per computer |
| Android | Chrome and a USB-C (OTG) adapter; the HDX runs on its own power supply. Use it in landscape |
| iPhone, iPad | Not possible: no iOS browser supports WebUSB |

<details>
<summary><b>Windows: install the WinUSB driver</b></summary>

1. Plug in the HDX and run [Zadig](https://zadig.akeo.ie).
2. Choose **Options → List All Devices** and select the HDX (USB ID `2457 2003`).
3. Select **WinUSB** and press **Replace Driver**.

OceanView will no longer see the HDX afterwards. To undo, uninstall the device in Device Manager and replug it.
</details>

<details>
<summary><b>Linux: allow USB access</b></summary>

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2457", ATTR{idProduct}=="2003", MODE="0666"' \
  | sudo tee /etc/udev/rules.d/99-ocean-hdx.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Replug the HDX afterwards. If Chromium was installed as a Snap, also run `sudo snap connect chromium:raw-usb`.
</details>

### Browsers

Spektra uses the [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API), available in
Chromium-based browsers on a secure (`https://`) page.

| Chrome (desktop, Android) | Edge | Opera | Firefox | Safari |
|:-:|:-:|:-:|:-:|:-:|
| ✅ 61+ | ✅ 79+ | ✅ 48+ | ❌ | ❌ |

## How it works

**Instrument.** The HDX speaks Ocean Insight's binary protocol (OBP) over USB bulk transfers. Spektra
implements it in JavaScript ([`src/device/hdx-usb.js`](src/device/hdx-usb.js)): message framing, resending
lost replies, the device's error codes, serial number, integration time, the wavelength calibration stored in
the instrument, and 2068-pixel spectra at 16 bits.

**Analysis** ([`src/analysis/peaks.js`](src/analysis/peaks.js), tested in Node):

1. Baseline and noise from the lowest 30 % of pixels (median, and 1.4826 × median absolute deviation).
2. Peaks where both height and prominence exceed 5 σ and 1 % of the strongest line, at least 2 nm apart.
3. Sub-pixel centre from a parabola through the logarithm of the three highest samples (exact for a Gaussian).
4. FWHM from the interpolated half-maximum crossings; area by trapezoid integration within ±1.5 FWHM.
5. Photon energy E = hc/λ (CODATA 2018). On the energy axis intensities are converted to counts per meV
   (I·λ²/hc per pixel width), so broad bands keep their true position and shape.

**Software.** Plain JavaScript modules served as static files: no build step, no dependencies besides the
vendored [uPlot](https://github.com/leeoniya/uPlot) chart library. The repository root is the website.

## Other spectrometers

Spektra is tested with the HDX. Other Ocean Insight models, especially newer ones that speak the same
protocol, should need little more than a per-model profile in the USB driver — but we cannot test them
without the hardware. **If you have one, test reports and contributions are very welcome;** see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development

```bash
npm start    # http://localhost:8000, no caching
npm test     # Node 18+, no packages to install
```

Without an instrument, open **http://localhost:8000/?mock**: a simulated HDX replaces the USB device
(localhost only). Project conventions for people and AI coding assistants are in [AGENTS.md](AGENTS.md).

## About

Spektra 2.0 is the browser successor of an earlier desktop program (1.x); see the [changelog](CHANGELOG.md).
It was developed by [Bilal Bera Meriç](https://github.com/berameric) at the
[Nano Optoelectronics Laboratories](https://nano-optoelectronics.istanbul.edu.tr/en/_), Istanbul University.

Plotting by [uPlot](https://github.com/leeoniya/uPlot) (MIT); icons from [Lucide](https://lucide.dev) (ISC).
Released under the [MIT licence](LICENSE).
