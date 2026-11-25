// Instrument profiles: what differs between Ocean Insight (Ocean Optics) spectrometers. Adding a model that
// speaks a supported protocol means adding an entry here; the drivers read everything model-specific from it.
//
// Identification data and acquisition parameters are taken from python-seabreeze
// (https://github.com/ap--/python-seabreeze, src/seabreeze/pyseabreeze/devices.py, MIT licence) and must be
// confirmed on the instrument. Only entries with `verified: true` have been tested with Spektra.

/** Protocols. Spektra implements OBP; the others are recognised so the user gets a clear message. */
export const OBP = "obp";   // Ocean Binary Protocol (HDX, STS, QE Pro, Spark, Ventana)
export const OBP2 = "obp2"; // newer protocol of the Ocean ST / SR / HR series (vendor ID 0x0999)
export const OOI = "ooi";   // legacy single-byte command protocol (USB2000+, USB4000, HR4000, …)

export const PROTOCOL_NAMES = { [OBP]: "Ocean Binary Protocol", [OBP2]: "Ocean Binary Protocol 2", [OOI]: "legacy Ocean Optics protocol" };

/** USB vendor IDs used by Ocean Insight instruments. */
export const OCEAN_VENDORS = [0x2457, 0x0999];

/**
 * Fields of a supported (OBP) profile:
 *   vendor, pid        USB identifiers
 *   model              display name
 *   protocol           OBP
 *   pixels             detector pixels in a spectrum
 *   pixelBytes         2 (16-bit) or 4 (32-bit) per pixel, little-endian; pixel data are the last bytes of the reply
 *   spectrumMessage    OBP message that returns a spectrum
 *   fullScale          largest count the detector reports
 *   intMinUs, intMaxUs integration-time limits in µs
 *   endpoints          { out, in } bulk endpoint numbers (default 1 and 1)
 *   verified           tested with Spektra on the instrument
 */
export const PROFILES = [
  {
    vendor: 0x2457, pid: 0x2003, model: "HDX", protocol: OBP, pixels: 2068, pixelBytes: 2,
    spectrumMessage: 0x00101000, fullScale: 65535, intMinUs: 6_000, intMaxUs: 10_000_000, verified: true,
  },
  {
    vendor: 0x2457, pid: 0x4000, model: "STS", protocol: OBP, pixels: 1024, pixelBytes: 2,
    spectrumMessage: 0x00101100, fullScale: 16383, intMinUs: 10, intMaxUs: 85_000_000, verified: false,
  },
  {
    vendor: 0x2457, pid: 0x4004, model: "QE Pro", protocol: OBP, pixels: 1044, pixelBytes: 4,
    spectrumMessage: 0x00100928, fullScale: 2 ** 18 - 1, intMinUs: 8_000, intMaxUs: 1_600_000_000, verified: false,
  },
  {
    vendor: 0x2457, pid: 0x4200, model: "Spark", protocol: OBP, pixels: 1024, pixelBytes: 2,
    spectrumMessage: 0x00101100, fullScale: 16383, intMinUs: 10, intMaxUs: 85_000_000, verified: false,
  },
  {
    vendor: 0x2457, pid: 0x5000, model: "Ventana", protocol: OBP, pixels: 1024, pixelBytes: 2,
    spectrumMessage: 0x00101100, fullScale: 65535, intMinUs: 22_000, intMaxUs: 60_000_000,
    endpoints: { out: 1, in: 2 }, verified: false,
  },

  // Recognised but not yet supported: the protocol is not implemented in Spektra
  ...[[0x1000, "Ocean ST"], [0x1001, "Ocean SR2"], [0x1002, "Ocean SR4"], [0x1003, "Ocean HR2"],
    [0x1004, "Ocean HR4"], [0x1005, "Ocean SR6"], [0x1006, "Ocean HR6"]]
    .map(([pid, model]) => ({ vendor: 0x0999, pid, model, protocol: OBP2 })),
  ...[[0x1002, "USB2000"], [0x1004, "ADC1000-USB"], [0x100a, "HR2000"], [0x1012, "HR4000"], [0x1014, "USB650"],
    [0x1016, "HR2000+"], [0x1018, "QE65000"], [0x101e, "USB2000+"], [0x1022, "USB4000"],
    [0x1026, "NIRQuest512"], [0x1028, "NIRQuest256"], [0x102a, "Maya2000 Pro"], [0x102c, "Maya2000"],
    [0x1040, "Torus"], [0x1044, "Apex"], [0x1046, "Maya LSL"], [0x2000, "Jaz"]]
    .map(([pid, model]) => ({ vendor: 0x2457, pid, model, protocol: OOI })),
];

/** The profile of a USB device, or null for an instrument not in the table. */
export const findProfile = (device) =>
  PROFILES.find((p) => p.vendor === device.vendorId && p.pid === device.productId) ?? null;

export const isOcean = (device) => OCEAN_VENDORS.includes(device.vendorId);

export const hex4 = (v) => "0x" + v.toString(16).padStart(4, "0");
