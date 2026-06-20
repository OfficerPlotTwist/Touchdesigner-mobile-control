import { scaffoldScript, effectPath as buildEffectPath, registryRow } from './contract.js';
import { pickRecycleIndex } from './gallery.js';

// Choose the lowest free index that isn't the safe index, given current registry.
function nextIndex(entries, safeIndex) {
  const used = new Set(entries.map((e) => e.index));
  let i = safeIndex + 1;
  while (used.has(i)) i += 1;
  return i;
}

async function withTimeout(promise, ms, controller) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => { controller.abort(); rej(new Error('job timeout')); }, ms); });
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

export async function processJob({ job, config, bridge, runAgentSession, now, onStatus }) {
  const { contract, jobTimeoutMs, galleryCap } = config;
  const fxPath = buildEffectPath(contract, job.requestId);
  onStatus(job.requestId, 'building', 'building your effect…');

  // 1. Bridge liveness (read-only probe first, per the skill's core workflow).
  if (!(await bridge.ping())) {
    return { state: 'failed', reason: 'bridge-down' };
  }

  // 2. Ensure contract exists (idempotent).
  await bridge.execScript(scaffoldScript(contract));

  // 3. Assign index, recycling the oldest non-live effect if at cap.
  const liveIndex = await bridge.getSwitch();
  const entries = await bridge.readRegistry();
  const recycle = pickRecycleIndex({ entries, cap: galleryCap, liveIndex, safeIndex: contract.safeIndex });
  if (recycle != null) {
    const victim = entries.find((e) => e.index === recycle);
    if (victim) await bridge.deleteOp(victim.compPath);
    await bridge.removeRegistryByIndex(recycle);
  }
  // Use the pre-recycle entries list so nextIndex skips the recycled slot,
  // advancing to the next free index rather than reusing the vacated one.
  const index = nextIndex(entries, contract.safeIndex);

  // 4. Delegate the creative build to the agent, bounded by the job timeout.
  const controller = new AbortController();
  try {
    await withTimeout(
      runAgentSession({ job, effectPath: fxPath, index, contract, bridge, signal: controller.signal }),
      jobTimeoutMs,
      controller,
    );
  } catch {
    await bridge.deleteOp(fxPath); // discard half-built container
    return { state: 'failed', reason: 'agent-failed' };
  }

  // 5. Verify gates: no errors in the subtree AND a non-blank render.
  const errs = await bridge.getErrors(fxPath);
  const nonBlank = await bridge.screenshotNonBlank(fxPath);
  if (errs.length > 0 || !nonBlank) {
    await bridge.deleteOp(fxPath);
    return { state: 'failed', reason: 'verify-failed' };
  }

  // 6. Register + switch (atomic order: author cell written before the switch).
  await bridge.appendRegistryRow(registryRow({
    index, compPath: fxPath, title: job.text, author: job.name, createdTs: Math.floor(now() / 1000),
  }));
  await bridge.setSwitch(index);
  onStatus(job.requestId, 'live', "it's on the wall ✦");
  return { state: 'live', index };
}

// Serial drain loop. Pulls one job at a time; never builds two concurrently.
export async function runWorker({ queue, config, bridge, runAgentSession, now, onStatus, shouldStop }) {
  while (!shouldStop()) {
    const job = queue.dequeue();
    if (!job) { await new Promise((r) => setTimeout(r, 50)); continue; }
    try {
      const r = await processJob({ job, config, bridge, runAgentSession, now, onStatus });
      if (r.state === 'failed') onStatus(job.requestId, 'failed', "couldn't build that — try rephrasing");
    } catch {
      onStatus(job.requestId, 'failed', 'internal error');
    }
  }
}
