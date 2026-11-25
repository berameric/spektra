// Node test for the OBP driver (src/device/obp-instrument.js, obp.js, usb-link.js) against fake devices
// speaking OBP, and for instrument recognition (index.js, profiles.js): node tests/test_web_usb.mjs
import assert from "node:assert/strict";
import { UnsupportedInstrument, openInstrument } from "../src/device/index.js";
import { ObpInstrument } from "../src/device/obp-instrument.js";
import { OBP, PROFILES, findProfile } from "../src/device/profiles.js";
import { bulkEndpoints, describeDevice } from "../src/device/probe.js";

const HDX = findProfile({ vendorId: 0x2457, productId: 0x2003 });
const HDX_PIXELS = HDX.pixels;

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

/**
 * Fake USBDevice speaking OBP: replies in 64-byte packets; can drop or duplicate replies on request.
 * `spec` describes the spectrum reply: message, pixel count, bytes per pixel and metadata bytes before the pixels.
 */
class FakeObpDevice {
  opened = false; configuration = null;
  queue = []; pending = []; sent = []; itime = 0;
  dropNext = 0; dupNext = 0; dupAt = -1; // dupAt: number of the request (count of sent) whose reply is repeated
  constructor(productId = 0x2003, spec = { message: 0x00101000, pixels: HDX_PIXELS, bytes: 2, meta: 64 }) {
    this.vendorId = 0x2457;
    this.productId = productId;
    this.spec = spec;
  }
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
    } else if (type === this.spec.message) {
      const { pixels, bytes, meta } = this.spec;
      reply = new Uint8Array(meta + pixels * bytes); // metadata + pixels
      const pv = new DataView(reply.buffer, meta);
      for (let i = 0; i < pixels; i++) {
        if (bytes === 4) pv.setUint32(4 * i, 100_000 + i, true);
        else pv.setUint16(2 * i, i % 65536, true);
      }
    } else {
      setTimeout(() => this._emit(frame(type, new Uint8Array(0), 2)), 1);
      return { status: "ok" };
    }
    if (this.dropNext > 0) { this.dropNext--; return { status: "ok" }; }
    const f = frame(type, reply), dup = this.sent.length === this.dupAt;
    setTimeout(() => {
      this._emit(f);
      if (this.dupNext > 0) { this.dupNext--; this._emit(f); }
      else if (dup) this._emit(f);
    }, 1);
    return { status: "ok" };
  }
}

const dev = new FakeObpDevice();
const hdx = await openInstrument(dev);
assert.ok(hdx instanceof ObpInstrument);
assert.equal(hdx.serialNumber, "HDX12345");
assert.equal(hdx.model, "HDX");
assert.equal(hdx.fullScale, 65535);

const wl = await hdx.wavelengths();
assert.equal(wl.length, HDX_PIXELS);
assert.ok(Math.abs(wl[0] - 200) < 1e-9 && Math.abs(wl[10] - 205) < 1e-6);

// A repeated coefficient reply must not shift the coefficients by one (it stretched the axis to millions of nm)
for (const k of [1, 2, 3, 4, 5]) {
  dev.dupAt = dev.sent.length + k; // the k-th request from here is answered twice
  const again = await hdx.wavelengths();
  assert.ok(Math.abs(again[0] - 200) < 1e-9 && Math.abs(again[10] - 205) < 1e-6, `duplicate reply to request ${k}: ${again[10]}`);
}
dev.dupAt = -1;

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

// Device errors surface with the OBP error number
await assert.rejects(hdx.obp.query(0x00999999), /Instrument error 2: unknown message type/);
await assert.rejects(hdx.readMessage(0x00101100), /Instrument error 2/);

await hdx.close();

// A model with 32-bit pixels after 32 bytes of metadata (QE Pro profile, not yet verified on hardware)
const qeProfile = findProfile({ vendorId: 0x2457, productId: 0x4004 });
const qe = await openInstrument(new FakeObpDevice(0x4004, { message: 0x00100928, pixels: qeProfile.pixels, bytes: 4, meta: 32 }));
assert.equal(qe.model, "QE Pro (experimental)");
await qe.setIntegrationUs(100_000);
const qs = await qe.intensities();
assert.equal(qs.length, qeProfile.pixels);
assert.equal(qs[0], 100_000);
assert.equal(qs[qeProfile.pixels - 1], 100_000 + qeProfile.pixels - 1);
await qe.close();

// Recognition: a legacy model and an unknown Ocean device are reported, not opened
const usb4000 = { vendorId: 0x2457, productId: 0x1022 };
assert.throws(() => openInstrument(usb4000), (e) => e instanceof UnsupportedInstrument && e.profile.model === "USB4000");
assert.throws(() => openInstrument({ vendorId: 0x2457, productId: 0x7777 }), (e) => e instanceof UnsupportedInstrument && e.profile === null);

// The profile table: unique USB IDs, and every supported (OBP) entry complete
const ids = PROFILES.map((p) => `${p.vendor}:${p.pid}`);
assert.equal(new Set(ids).size, ids.length, "duplicate USB IDs in the profile table");
for (const p of PROFILES.filter((q) => q.protocol === OBP)) {
  for (const key of ["model", "pixels", "pixelBytes", "spectrumMessage", "fullScale", "intMinUs", "intMaxUs"]) {
    assert.ok(p[key] !== undefined, `${p.model}: missing ${key}`);
  }
  assert.ok([2, 4].includes(p.pixelBytes) && p.intMinUs < p.intMaxUs, `${p.model}: inconsistent values`);
}
assert.ok(PROFILES.some((p) => p.verified) && PROFILES.filter((p) => p.verified).every((p) => p.protocol === OBP));

// The report reads descriptors only; endpoints come from the interface layout
const described = {
  vendorId: 0x2457, productId: 0x7777, productName: "Mystery", usbVersionMajor: 2, usbVersionMinor: 0,
  deviceVersionMajor: 1, deviceVersionMinor: 0, deviceVersionSubminor: 0,
  configurations: [{ interfaces: [{ interfaceNumber: 0, alternate: { endpoints: [
    { direction: "out", endpointNumber: 1, type: "bulk", packetSize: 512 },
    { direction: "in", endpointNumber: 2, type: "bulk", packetSize: 512 },
  ] } }] }],
};
assert.equal(describeDevice(described).productId, "0x7777");
assert.deepEqual(bulkEndpoints(described), { out: 1, in: 2 });

console.log("OK: OBP driver handles framing, retries, duplicates, errors, profiles and unknown instruments.");
