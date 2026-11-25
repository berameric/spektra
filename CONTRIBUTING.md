# Contributing

Contributions are welcome — most of all support for **other Ocean Insight (Ocean Optics) spectrometers**.
Spektra has only been tested with the HDX, because that is the instrument we have.

## Supporting another spectrometer

The interface and the analysis do not depend on the instrument. Everything model-specific lives in the
USB driver, [`src/device/hdx-usb.js`](src/device/hdx-usb.js).

**Models that speak the Ocean Binary Protocol (OBP)** — the newer Ocean Insight spectrometers — share the
message framing, the serial-number, integration-time and wavelength-coefficient commands with the HDX.
What differs per model:

| Setting | HDX value |
|---|---|
| USB product ID (vendor `0x2457`) | `0x2003` |
| Detector pixels | 2068 |
| Command that returns a spectrum | `0x00101000` |
| Pixel format / full scale | 16-bit, 65 535 counts |
| Integration time limits | 6 ms – 10 s |

Supporting such a model should mostly mean turning these constants into a per-model profile.

**Older models using the legacy single-byte command protocol** (for example the USB2000+, USB4000 or
HR4000 families) need a separate driver with the same interface as `HDXUSB`
(`wavelengths()`, `setIntegrationUs()`, `intensities()`, `close()`); the rest of Spektra works unchanged.

Check every value against Ocean Insight's protocol documentation for the model and firmware in question.

## If you have an instrument but do not write code

Open an issue with:

- the model and, if you can, the firmware version;
- its USB product ID — in Chrome open `chrome://usb-internals`, or run `lsusb` on Linux;
- what happens when you press **Connect HDX** (screenshots and the browser console help).

That is already enough to start a profile, and someone with the hardware is needed to test it anyway.

## Making a change

1. `npm start` serves the app at http://localhost:8000; `http://localhost:8000/?mock` runs it with a
   simulated HDX, no hardware needed.
2. `npm test` runs the analysis and driver tests (Node 18+, no packages to install).
3. Keep pull requests focused: one model or one feature at a time, and say which hardware you tested on.

Spektra is MIT licensed; by contributing you agree that your contribution is released under the same licence.
