// Node test for the WebUSB HDX driver (src/device/hdx-usb.js) against a fake device speaking OBP:
// node tests/test_web_usb.mjs
import assert from "node:assert/strict";
import { HDX_PIXELS, HDXUSB } from "../src/device/hdx-usb.js";

const START = 0xc0c1, END = 0xc2c3c4c5;

function frame(type, payload, errno = 0) {
  const imm = payload.length <= 16;
  const body = imm ? new Uint8Array(0) : payload;
  const buf = new Uint8Array(44 + body.length + 20);
  const v = new DataView(buf.buffer);
  v.setUint16(0, START, true);
  v.setUint16(2, 0x1100, true);
  v.setUint16(6, errno, true);
  v.setUint32(8, type, true);
  if (imm) { buf[23] = payload.length; buf.set(payload, 24); }
  v.setUint32(40, body.length + 20, true);
  buf.set(body, 44);
  v.setUint32(buf.length - 4, END, true);
  return buf;
}

/** Fake USBDevice: replies in 64-byte packets; can drop or duplicate replies on request. */
class FakeHDX {
  vendorId = 0x2457; productId = 0x2003; opened = false; configuration = null;
  queue = []; pending = []; sent = []; itime = 0;
  dropNext = 0; dupNext = 0;
  async open() { this.opened = true; }
  async selectConfiguration() { this.configuration = {}; }
  async claimInterface() {}
  async releaseInterface() { this.pending.forEach((p) => p.reject(new Error("released"))); }
  async close() { this.opened = false; }
  async clearHalt() {}
  async transferIn() {
    if (this.queue.length) return this._ok(this.queue.shift());
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
  }
  _ok(bytes) { return { status: "ok", data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) }; }
  _emit(bytes) {
    for (let i = 0; i < bytes.length; i += 64) {
      const pkt = bytes.slice(i, i + 64);
      const w = this.pending.shift();
      if (w) w.resolve(this._ok(pkt)); else this.queue.push(pkt);
    }
  }
  async transferOut(_ep, data) {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    assert.equal(v.getUint16(0, true), START);
    assert.equal(v.getUint32(data.length - 4, true), END);
    const type = v.getUint32(8, true), immLen = data[23];
    const payload = data.slice(24, 24 + immLen);
    this.sent.push(type);
    let reply;
    if (type === 0x00000100) reply = new TextEncoder().encode("HDX12345\0");
    else if (type === 0x00180100) reply = Uint8Array.of(2);
    else if (type === 0x00180101) {
      reply = new Uint8Array(4);
      new DataView(reply.buffer).setFloat32(0, payload[0] === 0 ? 200 : 0.5, true);
    } else if (type === 0x00110010) {
      this.itime = new DataView(payload.buffer, payload.byteOffset).getUint32(0, true);
      reply = new Uint8Array(0);
    } else if (type === 0x00101000) {
      reply = new Uint8Array(64 + HDX_PIXELS * 2); // metadata + pixels
      const pv = new DataView(reply.buffer, 64);
      for (let i = 0; i < HDX_PIXELS; i++) pv.setUint16(2 * i, i % 65536, true);
    } else {
      setTimeout(() => this._emit(frame(type, new Uint8Array(0), 2)), 1);
      return { status: "ok" };
    }
    if (this.dropNext > 0) { this.dropNext--; return { status: "ok" }; }
    const f = frame(type, reply);
    setTimeout(() => {
      this._emit(f);
      if (this.dupNext > 0) { this.dupNext--; this._emit(f); }
    }, 1);
    return { status: "ok" };
  }
}

const dev = new FakeHDX();
const hdx = await HDXUSB.open(dev);
assert.equal(hdx.serialNumber, "HDX12345");

const wl = await hdx.wavelengths();
assert.equal(wl.length, HDX_PIXELS);
assert.ok(Math.abs(wl[0] - 200) < 1e-9 && Math.abs(wl[10] - 205) < 1e-6);

await hdx.setIntegrationUs(50_000);
assert.equal(dev.itime, 50_000);
await assert.rejects(hdx.setIntegrationUs(1000), /outside/);

let spec = await hdx.intensities();
assert.equal(spec.length, HDX_PIXELS);
assert.equal(spec[0], 0);
assert.equal(spec[HDX_PIXELS - 1], HDX_PIXELS - 1);

// A duplicated reply must be skipped; the next query still gets its own answer
dev.dupNext = 1;
spec = await hdx.intensities();
assert.equal(spec[100], 100);
assert.equal((await hdx.wavelengths())[0], 200);

// A lost reply is resent after the timeout
dev.dropNext = 1;
const t0 = Date.now();
spec = await hdx.intensities();
assert.equal(spec[7], 7);
assert.ok(Date.now() - t0 >= 300, "expected a resend after the reply timeout");

// Concurrent calls are serialized
const [a, b] = await Promise.all([hdx.intensities(), hdx.setIntegrationUs(20_000)]);
assert.equal(a[5], 5);
assert.equal(dev.itime, 20_000);

// Device errors surface as HDXError
await assert.rejects(hdx._query(0x00999999), /HDX error 2/);

await hdx.close();
console.log("OK: WebUSB HDX driver handles framing, retries, duplicates and errors.");
