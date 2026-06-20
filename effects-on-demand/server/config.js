import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({
  queueBound: 20,
  jobTimeoutMs: 300000,
  galleryCap: 12,
  requestMaxLen: 280,
  nameMaxLen: 40,
  cooldownMs: 4000,
  contract: Object.freeze({
    effectsPath: '/project1/effects',
    switchPath: '/project1/fx_switch',
    registryPath: '/project1/fx_registry',
    safeIndex: 0,
  }),
});

const POS_INT_KEYS = ['queueBound', 'jobTimeoutMs', 'galleryCap', 'requestMaxLen', 'nameMaxLen', 'cooldownMs'];

export function validateConfig(obj) {
  const errors = [];
  if (obj == null || typeof obj !== 'object') return { ok: false, errors: ['config must be an object'] };

  const config = {
    ...DEFAULTS,
    contract: { ...DEFAULTS.contract, ...(obj.contract && typeof obj.contract === 'object' ? obj.contract : {}) },
  };

  for (const k of POS_INT_KEYS) {
    if (obj[k] === undefined) continue;
    if (!Number.isInteger(obj[k]) || obj[k] < 1) { errors.push(`${k} must be a positive integer`); continue; }
    config[k] = obj[k];
  }

  const c = config.contract;
  for (const k of ['effectsPath', 'switchPath', 'registryPath']) {
    if (typeof c[k] !== 'string' || !c[k].startsWith('/')) errors.push(`contract.${k} must be an absolute TD path`);
  }
  if (!Number.isInteger(c.safeIndex) || c.safeIndex < 0) errors.push('contract.safeIndex must be a non-negative integer');

  if (errors.length) return { ok: false, errors };
  return { ok: true, config };
}

export function loadConfig(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const r = validateConfig(raw);
  if (!r.ok) throw new Error(`Invalid effects config (${path}):\n  - ${r.errors.join('\n  - ')}`);
  return r.config;
}
