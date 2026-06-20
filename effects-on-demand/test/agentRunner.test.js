import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../worker/agentRunner.js';
import { DEFAULTS } from '../server/config.js';

test('system prompt hard-scopes the agent to its container and forbids the rest', () => {
  const p = buildSystemPrompt({ effectPath: '/project1/effects/fx_abc', contract: DEFAULTS.contract });
  assert.match(p, /\/project1\/effects\/fx_abc/);            // build target
  assert.match(p, /only inside/i);
  assert.match(p, /never|do not/i);
  assert.match(p, /fx_switch/);                              // must not flip the switch
  assert.match(p, /checkpoint/i);                            // checkpoint-before-structural
  assert.match(p, /TD_MCP|crowd|live/i);                     // forbidden neighbors
});
