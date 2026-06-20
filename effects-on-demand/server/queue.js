export class RequestQueue {
  constructor({ bound }) {
    this.bound = bound;
    this._items = [];
  }

  get length() { return this._items.length; }

  enqueue(job) {
    if (this._items.length >= this.bound) return { ok: false, code: 'busy' };
    this._items.push(job);
    return { ok: true, position: this._items.length };
  }

  dequeue() { return this._items.shift() ?? null; }

  positionOf(requestId) {
    const i = this._items.findIndex((j) => j.requestId === requestId);
    return i === -1 ? -1 : i + 1;
  }

  remove(requestId) {
    const i = this._items.findIndex((j) => j.requestId === requestId);
    if (i === -1) return false;
    this._items.splice(i, 1);
    return true;
  }
}
