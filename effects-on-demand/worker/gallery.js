// Decide which effect (if any) to evict before adding a new one. LRU by
// createdTs, never touching the live or reserved-safe index.
export function pickRecycleIndex({ entries, cap, liveIndex, safeIndex }) {
  if (entries.length < cap) return null;
  const eligible = entries
    .filter((e) => e.index !== liveIndex && e.index !== safeIndex)
    .sort((a, b) => a.createdTs - b.createdTs);
  return eligible.length ? eligible[0].index : null;
}
