# Troubleshooting

This page collects the connection problems people run into, with the message Spektra shows and what
fixes it. Spektra reports a failed connection as a notification starting with "Connection failed:" and
the underlying message. How the driver talks to the instrument is documented in
[PROTOCOL.md](PROTOCOL.md).

## 1. "Connection failed: ... access denied", "unable to claim", "failed to open" or "in use"

The browser cannot open the spectrometer. The cause depends on the operating system, and another
program holding the device gives the same message on any system.

### Windows: install the WinUSB driver

The browser can open the device only when the operating system allows user-space access to it. On
Windows this requires the generic WinUSB driver, installed once per computer:

1. Connect the HDX and run [Zadig](https://zadig.akeo.ie).
2. Choose **Options → List All Devices** and select the HDX (USB ID `2457 2003`).
3. Select **WinUSB** and press **Replace Driver**.

OceanView no longer recognises the HDX afterwards. To revert, uninstall the device in Device Manager
and reconnect it.

### Linux: add the udev rule

Create the rule granting access to the HDX, then reload the rules and reconnect the instrument:

```bash
echo 'SUBSYSTEM=="usb", ATTR{idVendor}=="2457", ATTR{idProduct}=="2003", MODE="0666"' \
  | sudo tee /etc/udev/rules.d/99-ocean-hdx.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

If Chromium is installed as a Snap package, also run `sudo snap connect chromium:raw-usb`. For a model
other than the HDX, use its product ID or leave `ATTR{idProduct}` out.

### Another tab or program has the instrument open

Only one holder can open a USB device at a time, so close every other tab or program that may be using
the spectrometer and try again. That includes OceanView: if OceanView still holds the device, Spektra
cannot claim it until OceanView is closed. (Installing the WinUSB driver, above, also stops OceanView
from recognising the HDX at all.)

macOS, ChromeOS and Android need no preparation; if the same message appears there, another program
holding the device is the likely cause.

## 2. "No reply to message ... after N attempts"

Spektra sent a request and received no reply. It repeats the request up to four times, and on a "No
reply" failure it issues a USB reset, waits 3 s for the device to settle, locates the device again and
repeats the connection sequence once. If it still does not answer, the instrument itself needs resetting.

### Switch the HDX off and on

The HDX keeps running on its own power supply after an interrupted session, and unplugging the USB cable
does not reset it. Switch the instrument off and on, then press **Connect** again.

### Try another USB adapter or cable

A faulty USB adapter or OTG cable gives "No reply" too. Try a different cable or adapter, and connect
the instrument directly rather than through a hub: over some USB paths, in particular through a hub, the
HDX occasionally loses a reply.

## 3. "Open the page over HTTPS" or the browser cannot open USB devices

WebUSB works only on `https://` pages or on `http://localhost`. Open the published address
(https://berameric.github.io/spektra/) or serve the folder locally (`npm start`, then
http://localhost:8000). WebUSB is available in Chrome 61+ (desktop and Android), Edge 79+ and Opera
48+; it is not available in Firefox or Safari, and no browser on iOS or iPadOS provides WebUSB.

## Still stuck

If none of the above fixes it, open an issue and include the exact message Spektra showed, the
operating system and browser, and whether the instrument appears in the browser's device dialog.
