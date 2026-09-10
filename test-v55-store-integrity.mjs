import assert from 'node:assert/strict';
import { installMetadataIntegrityForContext, mergeAuxiliaryChatState, writeMergedChatStore } from './v55-store-integrity.js';

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
// An auxiliary key that arrives only as an own property holding undefined was omitted, not erased.
// normalizeStore spreads its input, so this shape is reachable in production and treating it as
// authoritative dropped the summary tree and the floor-fold audit.
const omitted = mergeAuxiliaryChatState(previous, { ...replay, hierarchical_summaries: undefined });
assert.equal(omitted.hierarchical_summaries.level1[0].id, 's1', 'an undefined auxiliary value must not erase owned state');
assert.ok(omitted.entity_registry.e1);
assert.equal(omitted.setting_binding.world_id, 'world-1');
// An explicit null or replacement is still authoritative.
assert.equal(mergeAuxiliaryChatState(previous, { ...replay, hierarchical_summaries: null }).hierarchical_summaries, null);
assert.deepEqual(mergeAuxiliaryChatState(previous, { ...replay, hierarchical_summaries: { version: 3, level1: [] } }).hierarchical_summaries, { version: 3, level1: [] });
// SillyTavern loads a chat by assigning a brand-new chat_metadata object, so the plugin's own store
// write can run before the property guard is installed on it. The write site itself must preserve
// independently-owned state, or the summary tree and the fold audit die on every chat load.
const loaded = { aetheriaUnifiedMemoryV54: structuredClone(previous) };
assert.equal(writeMergedChatStore(loaded, 'aetheriaUnifiedMemoryV54', structuredClone(replay)), true);
assert.equal(loaded.aetheriaUnifiedMemoryV54.hierarchical_summaries.level1[0].id, 's1', 'an unguarded store write must not drop the summary tree');
assert.equal(loaded.aetheriaUnifiedMemoryV54.setting_binding.world_id, 'world-1');
assert.ok(loaded.aetheriaUnifiedMemoryV54.entity_registry.e1);
assert.deepEqual(Object.keys(loaded.aetheriaUnifiedMemoryV54.memories), ['fresh']);
assert.equal(loaded.aetheriaUnifiedMemoryV54.scene_summaries, undefined, 'derived keys are still rebuilt, not preserved');
assert.equal(writeMergedChatStore(null, 'aetheriaUnifiedMemoryV54', {}), false);
assert.equal(writeMergedChatStore('not-an-object', 'aetheriaUnifiedMemoryV54', {}), false);
console.log('PASS v5.5 store integrity: canonical replay preserves independently-owned chat state');
