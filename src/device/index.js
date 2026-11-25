// Entry point to the instruments: lets the user pick any Ocean Insight device, recognises it by its USB IDs
// and opens it with the driver its profile names. Nothing has to be configured by hand.

import { ObpInstrument } from "./obp-instrument.js";
import { OBP, OCEAN_VENDORS, findProfile, isOcean } from "./profiles.js";

export const usbSupported = () => typeof navigator !== "undefined" && "usb" in navigator;

/** Raised for an Ocean device without a supported profile; carries the device for the report. */
export class UnsupportedInstrument extends Error {
  constructor(device, profile) {
    super(profile ? `${profile.model} uses a protocol Spektra does not support yet` : "This instrument is not supported yet");
    this.device = device;
    this.profile = profile;
  }
}

/** Open a USB device with the driver for its model. */
export function openInstrument(device) {
  const profile = findProfile(device);
  if (profile?.protocol !== OBP) throw new UnsupportedInstrument(device, profile);
  return ObpInstrument.open(device, profile);
}

/**
 * Connect: a single Ocean device the browser already has permission for opens directly; otherwise the
 * browser's chooser lists every Ocean device, so an unsupported one can still be selected and reported.
 */
export async function connectInstrument() {
  const known = (await navigator.usb.getDevices()).filter(isOcean);
  const device = known.length === 1
    ? known[0]
    : await navigator.usb.requestDevice({ filters: OCEAN_VENDORS.map((vendorId) => ({ vendorId })) });
  return openInstrument(device);
}

/** True for the object of an open instrument whose USB device was just unplugged. */
export const isDeviceOf = (instrument, usbDevice) => instrument?.dev === usbDevice;
