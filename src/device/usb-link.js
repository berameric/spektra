// WebUSB transport shared by the protocol drivers: opens the device, keeps one loop reading the IN endpoint
// into a byte buffer (WebUSB transfers have no timeout) and lets callers wait for bytes with a deadline.

export class UsbError extends Error {}
export class ReplyTimeout extends Error {}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class UsbLink {
  /** `endpoints`: bulk endpoint numbers { out, in }. */
  constructor(device, endpoints = { out: 1, in: 1 }) {
    this.dev = device;
    this.ep = endpoints;
    this.rx = new Uint8Array(0);
    this.waiters = [];
    this.readerError = null;
    this.reading = false;
  }

  async open() {
    const d = this.dev;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    await d.claimInterface(0);
    this._startReader();
  }

  _startReader() {
    this.reading = true;
    (async () => {
      while (this.reading) {
        try {
          const r = await this.dev.transferIn(this.ep.in, 16384);
          if (r.status === "stall") {
            await this.dev.clearHalt("in", this.ep.in);
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

  /** Wait until at least n bytes are buffered; throws ReplyTimeout at the deadline (performance.now() time). */
  async waitBytes(n, deadline) {
    while (this.rx.length < n) {
      if (this.readerError) throw new UsbError(`USB read failed: ${this.readerError.message}`);
      const left = deadline - performance.now();
      if (left <= 0) throw new ReplyTimeout("timed out");
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => { clearTimeout(t); resolve(); });
      });
    }
  }

  /** Remove and return the first n buffered bytes. */
  take(n) {
    const out = this.rx.slice(0, n);
    this.rx = this.rx.slice(n);
    return out;
  }

  /** Wait, then discard everything received (late or stale replies). */
  async drain(ms = 300) {
    await sleep(ms);
    this.rx = new Uint8Array(0);
  }

  async write(bytes) {
    const r = await this.dev.transferOut(this.ep.out, bytes);
    if (r.status === "stall") {
      await this.dev.clearHalt("out", this.ep.out);
      throw new UsbError("USB write stalled");
    }
  }

  async close() {
    this.reading = false;
    try { await this.dev.releaseInterface(0); } catch { /* already released */ }
    try { await this.dev.close(); } catch { /* already closed */ }
  }
}
