import assert from 'node:assert/strict';
import { installMetadataIntegrityForContext, mergeAuxiliaryChatState } from './v55-store-integrity.js';

const previous = {
  version: '5.4', memories: { old: { id: 'old' } }, slots: {}, extractions: { old: {} }, baseline: { vector: {} }, vector: {},
  setting_binding: { world_id: 'world-1', baseline_revision_id: 'rev-1' },
  entity_registry: { e1: { entity_id: 'e1', aliases: ['Alice'] } },
  hierarchical_summaries: { version: 3, level1: [{ id: 's1', text: 'keep me' }] },
  scene_summaries: [{ scene_id: 'derived-old' }], v55_consistency: { at: 1 },
};
const replay = { version: '5.4', memories: { fresh: { id: 'fresh' } }, slots: {}, extractions: { fresh: {} }, baseline: { vector: {} }, vector: {} };
const merged = mergeAuxiliaryChatState(previous, replay);
assert.deepEqual(Object.keys(merged.memories), ['fresh']);
assert.equal(merged.setting_binding.world_id, 'world-1');
assert.ok(merged.entity_registry.e1);
assert.equal(merged.hierarchical_summaries.level1[0].id, 's1');
assert.equal(merged.scene_summaries, undefined);
assert.equal(merged.v55_consistency, undefined);
assert.equal(mergeAuxiliaryChatState(previous, { ...replay, setting_binding: null }).setting_binding, null);
const ctx = { chatMetadata: { aetheriaUnifiedMemoryV54: structuredClone(previous) } };
assert.equal(installMetadataIntegrityForContext(ctx), true);
ctx.chatMetadata.aetheriaUnifiedMemoryV54 = structuredClone(replay);
assert.equal(ctx.chatMetadata.aetheriaUnifiedMemoryV54.setting_binding.world_id, 'world-1');
assert.ok(ctx.chatMetadata.aetheriaUnifiedMemoryV54.entity_registry.e1);
assert.equal(ctx.chatMetadata.aetheriaUnifiedMemoryV54.hierarchical_summaries.level1.length, 1);
assert.deepEqual(Object.keys(ctx.chatMetadata.aetheriaUnifiedMemoryV54.memories), ['fresh']);
console.log('PASS v5.5 store integrity: canonical replay preserves independently-owned chat state');
