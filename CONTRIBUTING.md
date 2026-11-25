# Contributing

Contributions are welcome — most of all support for **other Ocean Insight (Ocean Optics) spectrometers**.
Spektra has only been tested with the HDX, because that is the instrument we have.

## Supporting another spectrometer

The interface and the analysis do not depend on the instrument. What differs between models is a table of
profiles, [`src/device/profiles.js`](src/device/profiles.js); Spektra recognises an instrument by its USB IDs
and opens it with the driver of its protocol, without any manual setting.

**Models that speak the Ocean Binary Protocol (OBP)** need only an entry in that table:

| Field | HDX value |
|---|---|
| USB vendor / product ID | `0x2457` / `0x2003` |
| Detector pixels, bytes per pixel | 2068, 2 |
| Message that returns a spectrum | `0x00101000` |
| Full scale | 65 535 counts |
| Integration time limits | 6 ms – 10 s |

The STS, QE Pro, Spark and Ventana are already in the table as unverified entries (values from
python-seabreeze). Testing one of them and reporting the result is the most useful contribution. The message
format and request–reply handling are documented in [docs/PROTOCOL.md](docs/PROTOCOL.md).

**Models using another protocol** — the Ocean ST/SR/HR series (OBP2) and the older single-byte command set
(USB2000+, USB4000, HR4000 and others) — are recognised, but need a driver with the same operations as
`ObpInstrument` (`wavelengths()`, `setIntegrationUs()`, `intensities()`, `close()`); the WebUSB transport in
`usb-link.js` can be reused.

Check every value against Ocean Insight's protocol documentation for the model and firmware in question.

## If you have an instrument but do not write code

Open Spektra, press **Connect HDX** and select your instrument. If it is not supported yet, Spektra shows a
report and an **Open a GitHub issue** button that fills in the issue for you; you can read everything before
submitting. If your instrument opens as *experimental*, please report whether spectra, wavelengths and
exposure look right. Someone with the hardware is needed to verify a profile anyway.

## Making a change

1. `npm start` serves the app at http://localhost:8000; `http://localhost:8000/?mock` runs it with a
   simulated HDX, no hardware needed.
2. `npm test` runs the analysis and driver tests (Node 18+, no packages to install).
3. Keep pull requests focused: one model or one feature at a time, and say which hardware you tested on.

## Working with AI coding assistants

AI-assisted contributions are welcome. Point your assistant at [AGENTS.md](AGENTS.md): it lists the
project's rules (no build step or dependencies, plain JavaScript modules, the dark design tokens, where
things live) and the pitfalls already met. You remain responsible for the change: read the diff, run the
tests, try it with `?mock`, and say in the pull request what was tested on real hardware.

Spektra is MIT licensed; by contributing you agree that your contribution is released under the same licence.
