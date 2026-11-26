// Ocean Binary Protocol (OBP): message framing and request–reply handling over a UsbLink.
// Message format and behaviour are documented in docs/PROTOCOL.md.

import { ReplyTimeout } from "./usb-link.js";

const FLAG_REQUEST_ACK = 0x0004, FLAG_NACK = 0x0008;
const HEADER_SIZE = 44, FOOTER_SIZE = 20;
const START = 0xc0c1, VERSION = 0x1100, END = 0xc2c3c4c5;

const OBP_ERRORS = {
  1: "unsupported protocol", 2: "unknown message type", 3: "bad checksum", 4: "message too large",
  5: "payload length mismatch", 6: "invalid payload", 7: "device not ready", 8: "unknown checksum type",
  9: "device reset", 10: "too many buses", 11: "out of memory", 12: "the requested information does not exist",
  13: "internal device error", 100: "could not decrypt", 101: "invalid firmware layout", 102: "wrong data packet size",
  103: "hardware revision not compatible with the firmware", 104: "flash map not compatible with the firmware",
  255: "response deferred",
};

/** An error reported by the instrument, or no reply after all attempts. */
export class ObpError extends Error {
  constructor(message, errno = 0) {
    super(message);
    this.errno = errno;
  }
}

export const hex8 = (v) => "0x" + v.toString(16).padStart(8, "0");

export class ObpChannel {
  constructor(link) {
    this.link = link;
    this.lock = Promise.resolve();
    this.staleWaitMs = 0; // set after a timeout: wait this long for a late reply to flush
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
    await this.link.write(buf);
  }

  /** Read one OBP message. Returns {type, payload}, or null for a corrupt frame. */
  async _receive(timeoutMs) {
    const link = this.link, deadline = performance.now() + timeoutMs;
    await link.waitBytes(HEADER_SIZE, deadline);
    let v = new DataView(link.rx.buffer, link.rx.byteOffset, link.rx.byteLength);
    if (v.getUint16(0, true) !== START) return null;
    const total = HEADER_SIZE + v.getUint32(40, true);
    await link.waitBytes(total, deadline);
    v = new DataView(link.rx.buffer, link.rx.byteOffset, link.rx.byteLength);
    if (v.getUint32(total - 4, true) !== END) return null; // lost or duplicated USB packet
    const msg = link.take(total);
    const flags = v.getUint16(4, true), errno = v.getUint16(6, true);
    if (flags & FLAG_NACK || errno) {
      throw new ObpError(`Instrument error ${errno}: ${OBP_ERRORS[errno] || "unknown"}`, errno);
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
   * Over some USB paths (seen through a hub) the instrument occasionally loses or repeats a reply
   * packet. All messages used here are idempotent, so stale/duplicate replies are discarded by
   * message type and a missing reply simply triggers a resend.
   */
  transact(msgType, payload, requestAck = false, timeoutMs = 1000, retries = 4) {
    return this._locked(async () => {
      let last = null;
      for (let attempt = 0; attempt < retries; attempt++) {
        if (this.staleWaitMs) {
          await this.link.drain(this.staleWaitMs);
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
            msg = await this._receive(timeoutMs);
          } catch (exc) {
            if (!(exc instanceof ReplyTimeout)) throw exc;
            // No reply in time. It may still arrive late; it must not be taken as the answer
            // to a later request. Flush it before the next send.
            last = exc;
            this.staleWaitMs = timeoutMs;
            break;
          }
          if (msg === null) {
            await this.link.drain();
            last = new Error("corrupt reply");
            break;
          }
          if (msg.type === msgType) return msg.payload;
          // reply to an earlier request: ignore and keep reading
        }
      }
      throw new ObpError(`No reply to message ${hex8(msgType)} after ${retries} attempts: ${last?.message}`);
    });
  }

  query(msgType, payload = new Uint8Array(0), timeoutMs = 1000) {
    return this.transact(msgType, payload, false, timeoutMs);
  }

  command(msgType, payload = new Uint8Array(0)) {
    return this.transact(msgType, payload, true);
  }
}
