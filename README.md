# Spektra

Web-based software for the **Ocean Insight HDX** spectrometer. It runs in the browser and talks to the
instrument directly over USB (WebUSB): nothing to install.

Developed at the Nano Optoelectronics Laboratories, Istanbul University.

## Getting started

1. Open Spektra in Google Chrome or Microsoft Edge.
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
npm start    # serves http://localhost:8000
npm test     # Node 18+
```

## Author

[Bilal Bera Meriç](https://github.com/berameric) — Nano Optoelectronics Laboratories, Istanbul University.

Plotting by [uPlot](https://github.com/leeoniya/uPlot) (MIT).
