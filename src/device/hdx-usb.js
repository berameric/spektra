// Minimal WebUSB driver for the Ocean Insight HDX (Ocean Binary Protocol).
// Works in Chromium browsers (Chrome, Edge) over HTTPS or localhost.
//
// WebUSB transfers have no timeout, so one background loop keeps reading the IN endpoint into a
// byte buffer and replies are parsed from that buffer with explicit deadlines.

export const VENDOR_ID = 0x2457;
export const HDX_PRODUCT_ID = 0x2003;
const EP = 1; // bulk OUT 0x01, bulk IN 0x81
export const HDX_PIXELS = 2068;
export const INT_TIME_MIN_US = 6_000;
export const INT_TIME_MAX_US = 10_000_000;

// OBP message types
const GET_SERIAL = 0x00000100;
const GET_SPECTRUM = 0x00101000; // the only spectrum message on the HDX (0x00101100 → error 2); no dark correction applied
const SET_ITIME_USEC = 0x00110010;
const GET_WL_COEFF_COUNT = 0x00180100;
const GET_WL_COEFF = 0x00180101;

const FLAG_REQUEST_ACK = 0x0004, FLAG_NACK = 0x0008;
const HEADER_SIZE = 44, FOOTER_SIZE = 20;
const START = 0xc0c1, VERSION = 0x1100, END = 0xc2c3c4c5;

const OBP_ERRORS = {
  1: "unsupported protocol", 2: "unknown message type", 3: "bad checksum", 4: "message too large",
  5: "payload length mismatch", 6: "invalid payload", 7: "device not ready", 8: "unknown checksum type",
  9: "device reset", 10: "too many buses", 11: "out of memory", 12: "command not found",
};

export class HDXError extends Error {}
class ReplyTimeout extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex = (v) => "0x" + v.toString(16).padStart(8, "0");

function checkIntegration(us) {
  if (!(us >= INT_TIME_MIN_US && us <= INT_TIME_MAX_US)) {
    throw new HDXError(`Integration time ${us} µs outside ${INT_TIME_MIN_US}-${INT_TIME_MAX_US} µs`);
  }
}

export class HDXUSB {
  model = "HDX";

  constructor(device) {
    this.dev = device;
    this.rx = new Uint8Array(0);
    this.waiters = [];
    this.readerError = null;
    this.reading = false;
    this.lock = Promise.resolve();
    this.intUs = 100_000;
    this.staleWaitMs = 0; // set after a timeout: wait this long for a late reply to flush
    this.serialNumber = "?";
  }

  // ------------------------------------------------------------------ discovery
  static supported() {
    return typeof navigator !== "undefined" && "usb" in navigator;
  }

  /** Ask the user to pick the HDX (browser permission prompt), then open it. */
  static async request() {
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: VENDOR_ID, productId: HDX_PRODUCT_ID }],
    });
    return HDXUSB.open(device);
  }

  static isHDX(device) {
    return device.vendorId === VENDOR_ID && device.productId === HDX_PRODUCT_ID;
  }

  static async open(device) {
    try {
      return await HDXUSB._tryOpen(device);
    } catch (exc) {
      if (!(exc instanceof HDXError && /No reply/.test(exc.message))) throw exc;
      // The HDX can stay unresponsive after an interrupted session (it is not power-cycled by
      // replugging USB when externally powered). A USB reset followed by settling brings it back.
      try {
        await device.open();
        await device.reset();
      } catch { /* the device may re-enumerate during reset */ }
      await sleep(3000);
      const again = (await navigator.usb.getDevices()).filter(HDXUSB.isHDX);
      return HDXUSB._tryOpen(again.includes(device) ? device : again[0] || device);
    }
  }

  static async _tryOpen(device) {
    const h = new HDXUSB(device);
    try {
      await h._init();
      return h;
    } catch (exc) {
      await h.close();
      throw exc;
    }
  }

  async _init() {
    const d = this.dev;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    await d.claimInterface(0);
    this._startReader();
    await this._drain(300);
    const raw = await this._query(GET_SERIAL);
    const end = raw.indexOf(0);
    this.serialNumber = new TextDecoder("ascii").decode(end >= 0 ? raw.subarray(0, end) : raw);
  }

  // ------------------------------------------------------------------ OBP transport
  _startReader() {
    this.reading = true;
    (async () => {
      while (this.reading) {
        try {
          const r = await this.dev.transferIn(EP, 16384);
          if (r.status === "stall") {
            await this.dev.clearHalt("in", EP);
          } else if (r.data && r.data.byteLength) {
            this._push(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
          }
        } catch (exc) {
          if (this.reading) this.readerError = exc;
          this.reading = false;
          this._wake();
        }
      }
    })();
  }

  _push(bytes) {
    const merged = new Uint8Array(this.rx.length + bytes.length);
    merged.set(this.rx);
    merged.set(bytes, this.rx.length);
    this.rx = merged;
    this._wake();
  }

  _wake() {
    const w = this.waiters;
    this.waiters = [];
    w.forEach((f) => f());
  }

  async _waitBytes(n, deadline) {
    while (this.rx.length < n) {
      if (this.readerError) throw new HDXError(`USB read failed: ${this.readerError.message}`);
      const left = deadline - performance.now();
      if (left <= 0) throw new ReplyTimeout("timed out");
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => { clearTimeout(t); resolve(); });
      });
    }
  }

  async _drain(ms = 300) {
    await sleep(ms);
    this.rx = new Uint8Array(0);
  }

  async _send(msgType, payload = new Uint8Array(0), requestAck = false) {
    const immediate = payload.length <= 16;
    const body = immediate ? new Uint8Array(0) : payload;
    const buf = new Uint8Array(HEADER_SIZE + body.length + FOOTER_SIZE);
    const v = new DataView(buf.buffer);
    v.setUint16(0, START, true);
    v.setUint16(2, VERSION, true);
    v.setUint16(4, requestAck ? FLAG_REQUEST_ACK : 0, true);
    v.setUint32(8, msgType, true);
    if (immediate) {
      v.setUint8(23, payload.length);
      buf.set(payload, 24);
    }
    v.setUint32(40, body.length + FOOTER_SIZE, true);
    buf.set(body, HEADER_SIZE);
    v.setUint32(buf.length - 4, END, true);
    const r = await this.dev.transferOut(EP, buf);
    if (r.status === "stall") {
      await this.dev.clearHalt("out", EP);
      throw new HDXError("USB write stalled");
    }
  }

  /** Read one OBP message. Returns {type, payload}, or null for a corrupt frame. */
  async _receiveMessage(timeoutMs) {
    const deadline = performance.now() + timeoutMs;
    await this._waitBytes(HEADER_SIZE, deadline);
    let v = new DataView(this.rx.buffer, this.rx.byteOffset, this.rx.byteLength);
    if (v.getUint16(0, true) !== START) return null;
    const total = HEADER_SIZE + v.getUint32(40, true);
    await this._waitBytes(total, deadline);
    v = new DataView(this.rx.buffer, this.rx.byteOffset, this.rx.byteLength);
    if (v.getUint32(total - 4, true) !== END) return null; // lost or duplicated USB packet
    const msg = this.rx.slice(0, total);
    this.rx = this.rx.slice(total);
    const flags = v.getUint16(4, true), errno = v.getUint16(6, true);
    if (flags & FLAG_NACK || errno) {
      throw new HDXError(`HDX error ${errno}: ${OBP_ERRORS[errno] || "unknown"}`);
    }
    const immLen = msg[23];
    const payload = immLen ? msg.slice(24, 24 + immLen) : msg.slice(HEADER_SIZE, total - FOOTER_SIZE);
    return { type: v.getUint32(8, true), payload };
  }

  _locked(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  /**
   * Send a request and return the payload of the matching reply.
   * Over some USB paths (seen through a hub) the HDX occasionally loses or repeats a reply
   * packet. All messages used here are idempotent, so stale/duplicate replies are discarded by
   * message type and a missing reply simply triggers a resend.
   */
  _transact(msgType, payload, requestAck = false, timeoutMs = 1000, retries = 4) {
    return this._locked(async () => {
      let last = null;
      for (let attempt = 0; attempt < retries; attempt++) {
        if (this.staleWaitMs) {
          await this._drain(this.staleWaitMs);
          this.staleWaitMs = 0;
        }
        try {
          await this._send(msgType, payload, requestAck);
        } catch (exc) {
          if (exc instanceof DOMException && exc.name === "NotFoundError") throw exc; // unplugged
          last = exc;
          continue;
        }
        for (let k = 0; k < 3; k++) {
          let msg;
          try {
            msg = await this._receiveMessage(timeoutMs);
          } catch (exc) {
            if (!(exc instanceof ReplyTimeout)) throw exc;
            // No reply in time. It may still arrive late; it must not be taken as the answer
            // to a later request. Flush it before the next send.
            last = exc;
            this.staleWaitMs = timeoutMs;
            break;
          }
          if (msg === null) {
            await this._drain();
            last = new Error("corrupt reply");
            break;
          }
          if (msg.type === msgType) return msg.payload;
          // reply to an earlier request: ignore and keep reading
        }
      }
      throw new HDXError(`No reply to message ${hex(msgType)} after ${retries} attempts: ${last?.message}`);
    });
  }

  _query(msgType, payload = new Uint8Array(0), timeoutMs = 1000) {
    return this._transact(msgType, payload, false, timeoutMs);
  }

  _command(msgType, payload = new Uint8Array(0)) {
    return this._transact(msgType, payload, true);
  }

  // ------------------------------------------------------------------ spectrometer API
  async wavelengths() {
    const n = (await this._query(GET_WL_COEFF_COUNT))[0];
    const coeffs = [];
    for (let i = 0; i < n; i++) {
      const p = await this._query(GET_WL_COEFF, Uint8Array.of(i));
      coeffs.push(new DataView(p.buffer, p.byteOffset, p.byteLength).getFloat32(0, true));
    }
    return Float64Array.from({ length: HDX_PIXELS }, (_, px) =>
      coeffs.reduce((sum, c, i) => sum + c * px ** i, 0));
  }

  async setIntegrationUs(us) {
    us = Math.round(us);
    checkIntegration(us);
    const p = new Uint8Array(4);
    new DataView(p.buffer).setUint32(0, us, true);
    await this._command(SET_ITIME_USEC, p);
    this.intUs = us;
  }

  async intensities() {
    // A lost reply is resent after this timeout, so keep the margin short: measured replies
    // arrive within the exposure time + a few ms.
    const raw = await this._query(GET_SPECTRUM, undefined, Math.floor(this.intUs / 1000) + 300);
    const need = HDX_PIXELS * 2;
    if (raw.length < need) throw new HDXError(`Short spectrum: ${raw.length} bytes, expected ${need}`);
    // Any metadata precedes the pixel data
    const v = new DataView(raw.buffer, raw.byteOffset + raw.length - need, need);
    return Float64Array.from({ length: HDX_PIXELS }, (_, i) => v.getUint16(2 * i, true));
  }

  /**
   * Diagnostics only: send a request without payload and return the reply payload as bytes. Used by the
   * ?diag page to compare spectrum messages; only for messages that read, never for ones that change settings.
   */
  async readMessage(msgType, timeoutMs = Math.floor(this.intUs / 1000) + 300) {
    return this._query(msgType, undefined, timeoutMs);
  }

  async close() {
    this.reading = false;
    try { await this.dev.releaseInterface(0); } catch { /* already released */ }
    try { await this.dev.close(); } catch { /* already closed */ }
  }
}
