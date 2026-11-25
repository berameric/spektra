// Report on an instrument Spektra does not support yet, so that a profile can be written for it.
// describeDevice() only reads the USB descriptors the browser already has: it sends nothing to the device.
// probeObp() sends read-only OBP requests; never use it on an instrument known to speak another protocol,
// whose firmware could take OBP bytes for commands.

import { ObpChannel, hex8 } from "./obp.js";
import { UsbLink } from "./usb-link.js";
import { PROTOCOL_NAMES, findProfile, hex4 } from "./profiles.js";

/** USB identification and endpoint layout, from the descriptors. */
export function describeDevice(device) {
  const profile = findProfile(device);
  return {
    vendorId: hex4(device.vendorId), productId: hex4(device.productId),
    productName: device.productName || null, manufacturerName: device.manufacturerName || null,
    usbVersion: `${device.usbVersionMajor}.${device.usbVersionMinor}`,
    deviceVersion: `${device.deviceVersionMajor}.${device.deviceVersionMinor}.${device.deviceVersionSubminor}`,
    knownAs: profile ? `${profile.model} (${PROTOCOL_NAMES[profile.protocol]})` : null,
    interfaces: (device.configuration ?? device.configurations?.[0])?.interfaces.map((itf) => ({
      number: itf.interfaceNumber,
      endpoints: itf.alternate.endpoints.map((e) => `${e.direction} ${e.endpointNumber} ${e.type} ${e.packetSize} B`),
    })) ?? [],
  };
}

/** First bulk OUT and IN endpoint numbers of interface 0, as the OBP link needs them. */
export function bulkEndpoints(device) {
  const eps = (device.configuration ?? device.configurations?.[0])?.interfaces[0]?.alternate.endpoints ?? [];
  const pick = (dir) => eps.find((e) => e.type === "bulk" && e.direction === dir)?.endpointNumber;
  return { out: pick("out") ?? 1, in: pick("in") ?? 1 };
}

// Read-only requests: serial number, calibration coefficients and the spectrum messages used by OBP models
const PROBES = [
  [0x00000100, "serial number"],
  [0x00180100, "wavelength coefficient count"],
  [0x00181100, "nonlinearity coefficient count"],
  [0x00101000, "spectrum (HDX)"],
  [0x00101100, "spectrum"],
  [0x00100928, "spectrum with metadata (QE Pro)"],
];

/** Each read-only OBP request with the reply size or the error. One attempt each, so it stays quick. */
export async function probeObp(device) {
  const link = new UsbLink(device, bulkEndpoints(device));
  const obp = new ObpChannel(link);
  const results = [];
  try {
    await link.open();
    await link.drain(300);
    for (const [type, what] of PROBES) {
      const t0 = performance.now();
      try {
        const reply = await obp.transact(type, undefined, false, 3000, 1);
        const ascii = type === 0x00000100 ? new TextDecoder("ascii").decode(reply).replace(/\0.*$/s, "") : undefined;
        results.push({ message: hex8(type), what, bytes: reply.length, ms: Math.round(performance.now() - t0), ...(ascii ? { text: ascii } : {}) });
      } catch (e) {
        results.push({ message: hex8(type), what, error: e.message });
      }
    }
  } catch (e) {
    results.push({ error: `could not open the device: ${e.message}` });
  } finally {
    await link.close();
  }
  return results;
}
