import { assertBridge } from '../worker/tdBridge.js';

// In-memory TdBridge for worker unit tests and local dry-runs. Deterministic.
export class MockTdBridge {
  constructor(opts = {}) {
    this.state = {
      registry: [],          // RegistryEntry[]
      switchIndex: 0,
      ops: new Set(),        // created op paths
      execLog: [],
    };
    this.knobs = {
      failBuildForRequestId: opts.failBuildForRequestId ?? null,
      blankForRequestId: opts.blankForRequestId ?? null,
      errorsForPath: opts.errorsForPath ?? {},   // path -> string[]
      bridgeDown: opts.bridgeDown ?? false,
    };
    assertBridge(this);
  }

  async ping() { return !this.knobs.bridgeDown; }

  async execScript(code) {
    if (this.knobs.bridgeDown) throw new Error('bridge down');
    this.state.execLog.push(code);
    return { ok: true, stdout: 'ok' };
  }

  async readRegistry() { return this.state.registry.map((e) => ({ ...e })); }

  async appendRegistryRow(cells) {
    const [index, compPath, title, author, createdTs] = cells;
    this.state.registry.push({
      index: Number(index), compPath, title, author, createdTs: Number(createdTs),
    });
  }

  async removeRegistryByIndex(index) {
    this.state.registry = this.state.registry.filter((e) => e.index !== index);
  }

  async deleteOp(path) { this.state.ops.delete(path); }

  async getErrors(path) { return this.knobs.errorsForPath[path] ?? []; }

  async screenshotNonBlank(path) {
    // A container is "blank" only if explicitly flagged for its request id.
    return !(this.knobs.blankForRequestId && path.includes(this.knobs.blankForRequestId));
  }

  async setSwitch(index) { this.state.switchIndex = index; }
  async getSwitch() { return this.state.switchIndex; }
}

// Allow `node tools/mock-td.js` to be a no-op entry (kept for parity with sibling tools).
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('MockTdBridge is a library used by tests; nothing to run.');
}
