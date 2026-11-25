# Instrument communication

This document describes how Spektra communicates with the Ocean Insight HDX. Spektra does not use the
manufacturer's driver, SDK or application software. It implements the instrument's message protocol, the
Ocean Binary Protocol (OBP), directly in JavaScript and exchanges the messages over USB through the browser's
WebUSB interface. The implementation is [`src/device/hdx-usb.js`](../src/device/hdx-usb.js); every value given
below is taken from it.

The document covers only the part of OBP that Spektra uses. For the complete protocol, refer to Ocean
Insight's documentation for the instrument and its firmware.

## 1. USB transport

| Item | Value |
|---|---|
| Vendor ID, product ID | `0x2457`, `0x2003` |
| Configuration, interface | 1, 0 |
| Endpoints | bulk OUT `0x01`, bulk IN `0x81` |
| Byte order | little-endian throughout |

The browser grants access to the device only after the user selects it in a permission dialog
(`navigator.usb.requestDevice` with the vendor and product IDs as a filter). A device already granted
permission is opened directly. Opening consists of `open()`, `selectConfiguration(1)` when no configuration is
active, and `claimInterface(0)`.

WebUSB transfers have no timeout. Spektra therefore runs a single reading loop that requests up to 16 384 bytes
from the IN endpoint at a time and appends whatever arrives to a receive buffer. Messages are parsed from this
buffer, and waiting for a reply is bounded by an explicit deadline. A stalled endpoint is cleared with
`clearHalt` and the transfer repeated.

Operating-system requirements follow from this design: the browser can open the device only when the operating
system allows user-space access to it. On Windows this requires the generic WinUSB driver; on Linux, a udev rule
granting access; macOS, ChromeOS and Android need no preparation.

## 2. Message format

Every message, in both directions, consists of a 44-byte header, an optional payload and a 20-byte footer.

| Bytes | Field | Use in Spektra |
|---|---|---|
| 0–1 | start marker | `0xC0C1` |
| 2–3 | protocol version | `0x1100` |
| 4–5 | flags | `0x0004` requests an acknowledgement; `0x0008` in a reply marks a negative acknowledgement |
| 6–7 | error number | 0 in a successful reply; otherwise one of the error codes in Section 5 |
| 8–11 | message type | see Section 3 |
| 12–22 | further header fields | not used by Spektra; sent as zero |
| 23 | immediate data length | number of payload bytes carried inside the header (0–16) |
| 24–39 | immediate data | payloads of up to 16 bytes |
| 40–43 | bytes remaining | length of the payload plus footer that follow the header |
| … | payload | payloads longer than 16 bytes |
| last 20 | footer | last 4 bytes: end marker `0xC2C3C4C5`; the 16 bytes before it are sent as zero |

A payload of at most 16 bytes travels inside the header ("immediate data") and the message is 64 bytes long;
longer payloads follow the header. Spektra sends no checksum.

A received message is accepted when it begins with the start marker and ends, at the length given by the
"bytes remaining" field, with the end marker. A message that fails either test is treated as corrupt: the
receive buffer is discarded and the request is repeated (Section 4).

## 3. Messages used

| Message type | Purpose | Request payload | Reply payload |
|---|---|---|---|
| `0x00000100` | serial number | — | ASCII text, terminated by a zero byte |
| `0x00180100` | number of wavelength coefficients | — | one byte, *n* |
| `0x00180101` | wavelength coefficient *i* | one byte, *i* | 32-bit float |
| `0x00110010` | set integration time | 32-bit unsigned integer, µs (6 000 – 10 000 000) | acknowledgement |
| `0x00101000` | raw spectrum | — | 2 068 pixels × 16-bit unsigned integer, preceded by optional metadata |

**Wavelength calibration.** The instrument stores the coefficients of a polynomial in the pixel index *p*.
Spektra reads the *n* coefficients *c*ᵢ at connection and computes λ(*p*) = Σᵢ *c*ᵢ *p*ⁱ for *p* = 0 … 2067.

**Spectrum.** The pixel data are the last 4 136 bytes of the reply payload; any bytes before them are metadata
and are ignored. A shorter payload is reported as an error.

**Integration time.** Sent with the acknowledgement flag set, so the instrument confirms the change before the
next spectrum is requested.

## 4. Request–reply handling

One request is outstanding at a time; further requests wait for it to complete.

1. The request is written to the OUT endpoint.
2. Messages are read from the receive buffer until one arrives whose message type matches the request. Replies
   of other types, left over from earlier requests, are discarded (at most three per attempt).
3. The reply deadline is 1 s, and for a spectrum the integration time plus 300 ms.
4. If no reply arrives in time, the request is sent again, up to four attempts in total. Before the next
   attempt, Spektra waits for the length of the deadline and discards whatever arrives, so that a late reply to
   the previous attempt cannot be taken as the answer to the new one.
5. A reply with the negative-acknowledgement flag or a non-zero error number is reported to the user together
   with the error text.

Repeating a request is safe because every message used is idempotent: reading a value or setting the same
integration time again has no further effect.

These rules respond to behaviour observed with the instrument. Over some USB paths, in particular through a
hub, the HDX occasionally loses a reply or delivers one twice; matching replies by message type and resending on
timeout makes acquisition robust to both.

## 5. Error numbers

| No. | Meaning | No. | Meaning |
|---|---|---|---|
| 1 | unsupported protocol | 7 | device not ready |
| 2 | unknown message type | 8 | unknown checksum type |
| 3 | bad checksum | 9 | device reset |
| 4 | message too large | 10 | too many buses |
| 5 | payload length mismatch | 11 | out of memory |
| 6 | invalid payload | 12 | command not found |

## 6. Connection sequence and recovery

At connection Spektra opens the device, starts the reading loop, waits 300 ms and discards any bytes already
received, then requests the serial number. The wavelength coefficients are read next and the integration time is
set.

When the instrument is powered from its own supply, unplugging the USB cable does not reset it, and after an
interrupted session it may not answer. If the serial-number request receives no reply, Spektra issues a USB
reset, waits 3 s for the device to settle, locates it again and repeats the connection sequence once.

## 7. Adding another instrument

The protocol layer (Sections 1, 2, 4 and 5) is shared by Ocean Insight instruments that use OBP. The following
are specific to the HDX and would form a per-model profile:

| Parameter | HDX |
|---|---|
| USB product ID | `0x2003` |
| Number of pixels | 2 068 |
| Spectrum message type and pixel format | `0x00101000`, 16-bit unsigned |
| Full-scale count | 65 535 |
| Integration-time limits | 6 ms – 10 s |

Each value must be taken from the manufacturer's documentation for the model and firmware concerned and
verified on the instrument. Instruments that use Ocean Insight's earlier, non-OBP command set require a separate
driver offering the same four operations: `wavelengths()`, `setIntegrationUs()`, `intensities()` and `close()`.
The simulated instrument in [`src/device/mock-hdx.js`](../src/device/mock-hdx.js) shows this interface in its
simplest form. See also [CONTRIBUTING.md](../CONTRIBUTING.md).

## 8. Verification

[`tests/test_web_usb.mjs`](../tests/test_web_usb.mjs) runs the driver in Node against an emulated device that
speaks the message format above, including lost and duplicated replies and error replies. The driver has been used with
an HDX connected to computers running Linux and to an Android phone.
