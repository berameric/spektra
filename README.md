# Spektra

Free, open-source software for the **Ocean Insight HDX** spectrometer (Ocean Optics). It runs in the browser
and talks to the instrument directly over USB (WebUSB): nothing to install, no OceanView licence needed.
Live spectra, automatic peak detection with FWHM, wavelength (nm) and photon-energy (eV) axes, dark
subtraction, averaging and CSV export.

**[Open Spektra →](https://berameric.github.io/spektra/)**

![Spektra showing a live spectrum with detected peaks (simulated data)](assets/screenshot.png)

Developed at the Nano Optoelectronics Laboratories, Istanbul University.

**Version 2.0** — the browser successor of the earlier desktop program (1.x). See the [changelog](CHANGELOG.md).

## Getting started

1. Open **[berameric.github.io/spektra](https://berameric.github.io/spektra/)** in Google Chrome or Microsoft Edge.
2. Plug in the HDX and press **Connect HDX**.
3. Choose the HDX in the browser's device dialog, then press **Live**.

On first start Spektra checks your system and tells you if anything below is still missing.

## Platform setup

| Platform | Setup |
|---|---|
| macOS | None |
| ChromeOS | None |
| Windows | Install the WinUSB driver once (see below) |
| Linux | Add a udev rule once (see below) |
| Android, iOS | Not supported |

### Windows

1. Plug in the HDX and run [Zadig](https://zadig.akeo.ie).
2. Choose **Options → List All Devices** and select the HDX (USB ID `2457 2003`).
3. Select **WinUSB** and press **Replace Driver**.

OceanView will no longer see the HDX afterwards. To undo, uninstall the device in Device Manager and replug it.

### Linux

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2457", ATTR{idProduct}=="2003", MODE="0666"' \
  | sudo tee /etc/udev/rules.d/99-ocean-hdx.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

Replug the HDX afterwards.

## Browser compatibility

Spektra needs the [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) and a secure
context (`https://` or `http://localhost`).

| Browser | Supported |
|---|---|
| Chrome | ✅ 61+ |
| Edge | ✅ 79+ |
| Opera | ✅ 48+ |
| Firefox | ❌ |
| Safari | ❌ |

## Development

No build step; the repository root is the site.

```bash
npm start    # serves http://localhost:8000 (no caching, so edits always load)
npm test     # Node 18+
```

Without an instrument, open **http://localhost:8000/?mock**: a simulated HDX (mercury lines and a broad
emission band) replaces the USB device. It is available on `localhost` only.

## Other spectrometers

Spektra is tested with the HDX only. Other Ocean Insight models, especially the newer ones that speak the
same Ocean Binary Protocol, should need little more than a per-model profile in the USB driver — but we
cannot test them without the hardware. **If you have one, contributions and test reports are very
welcome;** see [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

[Bilal Bera Meriç](https://github.com/berameric) — Nano Optoelectronics Laboratories, Istanbul University.

Plotting by [uPlot](https://github.com/leeoniya/uPlot) (MIT); icons from [Lucide](https://lucide.dev) (ISC).

## License

[MIT](LICENSE)
