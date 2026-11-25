// A spectrometer that speaks OBP, driven by its profile (src/device/profiles.js): serial number, wavelength
// calibration from the instrument, integration time and spectra. Interface used by the app and the mock:
// model, serialNumber, profile, fullScale, wavelengths(), setIntegrationUs(), intensities(), readMessage(), close().

import { ObpChannel, ObpError } from "./obp.js";
import { UsbLink, sleep } from "./usb-link.js";

const GET_SERIAL = 0x00000100;
const SET_ITIME_USEC = 0x00110010;
const GET_WL_COEFF_COUNT = 0x00180100;
const GET_WL_COEFF = 0x00180101;

export class ObpInstrument {
  constructor(device, profile) {
    this.dev = device;
    this.profile = profile;
    this.model = profile.verified ? profile.model : `${profile.model} (experimental)`;
    this.fullScale = profile.fullScale;
    this.link = new UsbLink(device, profile.endpoints);
    this.obp = new ObpChannel(this.link);
    this.intUs = 100_000;
    this.serialNumber = "?";
  }

  static async open(device, profile, usb = navigator.usb) {
    try {
      return await ObpInstrument._tryOpen(device, profile);
    } catch (exc) {
      if (!(exc instanceof ObpError && /No reply/.test(exc.message))) throw exc;
      // The instrument can stay unresponsive after an interrupted session (it is not power-cycled by
      // replugging USB when externally powered). A USB reset followed by settling brings it back.
      try {
        await device.open();
        await device.reset();
      } catch { /* the device may re-enumerate during reset */ }
      await sleep(3000);
      const same = (d) => d.vendorId === device.vendorId && d.productId === device.productId;
      const again = (await usb.getDevices()).filter(same);
      return ObpInstrument._tryOpen(again.includes(device) ? device : again[0] || device, profile);
    }
  }

  static async _tryOpen(device, profile) {
    const inst = new ObpInstrument(device, profile);
    try {
      await inst.link.open();
      await inst.link.drain(300);
      const raw = await inst.obp.query(GET_SERIAL);
      const end = raw.indexOf(0);
      inst.serialNumber = new TextDecoder("ascii").decode(end >= 0 ? raw.subarray(0, end) : raw);
      return inst;
    } catch (exc) {
      await inst.close();
      throw exc;
    }
  }

  async wavelengths() {
    const n = (await this.obp.query(GET_WL_COEFF_COUNT))[0];
    const coeffs = [];
    for (let i = 0; i < n; i++) {
      const p = await this.obp.query(GET_WL_COEFF, Uint8Array.of(i));
      coeffs.push(new DataView(p.buffer, p.byteOffset, p.byteLength).getFloat32(0, true));
    }
    return Float64Array.from({ length: this.profile.pixels }, (_, px) =>
      coeffs.reduce((sum, c, i) => sum + c * px ** i, 0));
  }

  async setIntegrationUs(us) {
    us = Math.round(us);
    const { intMinUs, intMaxUs } = this.profile;
    if (!(us >= intMinUs && us <= intMaxUs)) {
      throw new ObpError(`Integration time ${us} µs outside ${intMinUs}-${intMaxUs} µs`);
    }
    const p = new Uint8Array(4);
    new DataView(p.buffer).setUint32(0, us, true);
    await this.obp.command(SET_ITIME_USEC, p);
    this.intUs = us;
  }

  async intensities() {
    const { pixels, pixelBytes, spectrumMessage } = this.profile;
    // A lost reply is resent after this timeout, so keep the margin short: measured replies
    // arrive within the exposure time + a few ms.
    const raw = await this.obp.query(spectrumMessage, undefined, Math.floor(this.intUs / 1000) + 300);
    const need = pixels * pixelBytes;
    if (raw.length < need) throw new ObpError(`Short spectrum: ${raw.length} bytes, expected ${need}`);
    // Any metadata precedes the pixel data
    const v = new DataView(raw.buffer, raw.byteOffset + raw.length - need, need);
    return Float64Array.from({ length: pixels }, (_, i) =>
      (pixelBytes === 4 ? v.getUint32(4 * i, true) : v.getUint16(2 * i, true)));
  }

  /**
   * Diagnostics only: send a request without payload and return the reply payload as bytes; for
   * messages that read, never for ones that change settings.
   */
  readMessage(msgType, timeoutMs = Math.floor(this.intUs / 1000) + 300) {
    return this.obp.query(msgType, undefined, timeoutMs);
  }

  close() {
    return this.link.close();
  }
}
