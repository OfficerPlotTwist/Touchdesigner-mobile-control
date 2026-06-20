/**
 * TdBridge — the deterministic surface the worker uses to drive TouchDesigner.
 * The creative "build inside this container" work is delegated to the GLM agent
 * (see agentRunner.js); everything safety-critical (scaffold, verify gates,
 * registry writes, switch, recycle) goes through these methods so the worker is
 * unit-testable against MockTdBridge.
 *
 * @typedef {Object} RegistryEntry
 * @property {number} index
 * @property {string} compPath
 * @property {string} title
 * @property {string} author
 * @property {number} createdTs
 *
 * @typedef {Object} TdBridge
 * @property {() => Promise<boolean>} ping
 * @property {(code: string) => Promise<{ ok: boolean, stdout: string }>} execScript
 * @property {() => Promise<RegistryEntry[]>} readRegistry
 * @property {(rowCells: string[]) => Promise<void>} appendRegistryRow
 * @property {(index: number) => Promise<void>} removeRegistryByIndex
 * @property {(path: string) => Promise<void>} deleteOp
 * @property {(path: string) => Promise<string[]>} getErrors
 * @property {(path: string) => Promise<boolean>} screenshotNonBlank
 * @property {(index: number) => Promise<void>} setSwitch
 * @property {() => Promise<number>} getSwitch
 */

export const BRIDGE_METHODS = [
  'ping', 'execScript', 'readRegistry', 'appendRegistryRow', 'removeRegistryByIndex',
  'deleteOp', 'getErrors', 'screenshotNonBlank', 'setSwitch', 'getSwitch',
];

/** Throws if `obj` is missing any TdBridge method — use to validate a bridge impl at startup. */
export function assertBridge(obj) {
  for (const m of BRIDGE_METHODS) {
    if (typeof obj[m] !== 'function') throw new Error(`TdBridge missing method: ${m}`);
  }
  return obj;
}
