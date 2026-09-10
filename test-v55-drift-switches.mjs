// Iteration 14 architecture-drift fixes: the three switches that turned implicit behaviour into a
// named decision, so a memory-only run is constructible and the current-state baseline is explicit.
import assert from 'node:assert/strict';
import { createEmptyStore, applyMemoryOps } from './memory-core.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';

const settings = {
  enabled: true,
  semantic_baseline_gate: true,
  setting_baseline_veto_enabled: true,
  setting_query_seed_from_memories: true,
  current_state_scope: 'mandatory+broad',
  setting_retrieval_enabled: false,
  baseline_lexical_threshold: 0.82,
  baseline_similarity_threshold: 0.84,
  baseline_semantic_lexical_floor: 0.3,
  max_active_items: 4,
  baseline_chunk_chars: 400,
  baseline_use_vector: false,
};

const store = createEmptyStore();
store.memories.m1 = {
  id: 'm1', kind: 'state', slot: 'z.location.current', text: '林昭位于钟楼旅店。',
  entities: ['林昭'], status: 'active', importance: 'normal', source_message: 2,
};
const ctx = {
  extensionSettings: { [SETTINGS_KEY]: settings, vectors: { source: 'transformers' } },
  chatMetadata: { [METADATA_KEY]: store },
  chat: [],
  name2: '林昭',
  characterId: 0,
  getCurrentChatId: () => 'drift-switches',
  getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  saveSettingsDebounced: () => {},
  saveMetadataDebounced: () => {},
  eventSource: { on: () => {}, emit: () => {} },
  eventTypes: {},
};
globalThis.SillyTavern = { getContext: () => ctx };

const {
  __testExtractionBudgetLadder,
  __testCreatePluginBaselineDeduper,
  __testResolveCurrentStateScope,
  __testRetrieveGenerationSettings,
  __testGetLastSettingSeedDebug,
} = await import('./index.js');

// --- 1. setting -> memory: the world-info plane could silently veto a memory write.
const chunkText = '塞拉菲娜持有黄铜钥匙。';
const prepared = {
  chunks: [{ chunk_id: 'c1', source_id: 's1', entry_id: 'e1', body_text: chunkText, retrieval_text: chunkText }],
};
const operation = { op: 'add', kind: 'ownership', slot: 'k.ownership.holder', text: chunkText };

let verdict = await __testCreatePluginBaselineDeduper(ctx, prepared).findPossibleMatches(operation);
assert.equal(verdict.blocked, true, 'world info rejects a memory that only restates it');
assert.notEqual(verdict.reason, 'setting-veto-disabled');

settings.setting_baseline_veto_enabled = false;
verdict = await __testCreatePluginBaselineDeduper(ctx, prepared).findPossibleMatches(operation);
assert.equal(verdict.blocked, false, 'the switch removes setting -> memory entirely');
assert.equal(verdict.reason, 'setting-veto-disabled', 'and it says so, rather than looking like a near-miss');
assert.ok(verdict.records.length >= 1, 'the records are still available for inspection');
settings.setting_baseline_veto_enabled = true;

// --- 2. memory -> setting: active memories used to seed the setting query implicitly.
settings.setting_query_seed_from_memories = true;
await __testRetrieveGenerationSettings(ctx, [{ mes: '你好', is_user: true }], store);
let seed = __testGetLastSettingSeedDebug();
assert.equal(seed.scope, 'generation');
assert.equal(seed.from_memories, true);
assert.equal(seed.memory_seed_count, 1, 'the active memory really was carried into the query');

settings.setting_query_seed_from_memories = false;
await __testRetrieveGenerationSettings(ctx, [{ mes: '你好', is_user: true }], store);
seed = __testGetLastSettingSeedDebug();
assert.equal(seed.from_memories, false);
assert.equal(seed.memory_seed_count, 0, 'and with the switch off the memory channel no longer reaches the setting query');
settings.setting_query_seed_from_memories = true;

// --- 3. the current-state block is a wider baseline than the mandatory set, and now says which.
assert.equal(__testResolveCurrentStateScope({ current_state_scope: 'mandatory-only' }), 'mandatory-only');
assert.equal(__testResolveCurrentStateScope({ current_state_scope: 'mandatory+broad' }), 'mandatory+broad');
assert.equal(__testResolveCurrentStateScope({}), 'mandatory+broad', 'the default preserves the behaviour users already have');
assert.equal(__testResolveCurrentStateScope({ current_state_scope: 'nonsense' }), 'mandatory+broad', 'an unknown value cannot silently narrow the baseline');

// The scope must actually change what the assembler renders, not just report a label.
const { __test: assembler } = await import('./context-assembler.js');
const { buildCurrentStateBlock } = assembler;
const irreversible = { id: 'a', kind: 'commitment', slot: 'p.commitment.x', text: '林昭答应在月圆之夜归还罗盘。' };
const ordinary = { id: 'b', kind: 'state', slot: 'z.location.current', text: '林昭位于钟楼旅店。' };
const all = buildCurrentStateBlock({ activeState: '', activeMemories: [irreversible, ordinary], maxCurrentStateChars: 3000, mandatoryIds: new Set(['a']) });
assert.ok(all.includes('Must-remember'), 'the mandatory rows are rendered first and labelled');
assert.ok(all.includes('罗盘') && all.includes('钟楼旅店'), 'the broad scope renders ordinary active memories too');
const narrow = buildCurrentStateBlock({ activeState: '', activeMemories: [irreversible], maxCurrentStateChars: 3000, mandatoryIds: new Set(['a']) });
assert.ok(narrow.includes('罗盘'), 'mandatory-only still carries the irreversible change');
assert.equal(narrow.includes('钟楼旅店'), false, 'and nothing else, which is what makes the comparison constructible');

// --- 4. The extraction retry ladder must escalate, never shrink.
// Measured live: a reasoning model at 2048 tokens routinely answers "No message generated", so the
// first rung starves. The third rung used to fall back to the base budget, which meant retrying a
// starved request with half the room it had just failed with.
const ladder = __testExtractionBudgetLadder(2048);
assert.deepEqual(ladder, { first: 2048, retry: 4096, plain: 8192 }, 'the ladder escalates for the measured live budget');
assert.ok(ladder.first <= ladder.retry && ladder.retry <= ladder.plain, 'budgets never decrease');
const capped = __testExtractionBudgetLadder(6000);
assert.equal(capped.plain, 8192, 'the last rung is capped, not unbounded');
assert.ok(capped.plain >= capped.retry && capped.retry >= capped.first);
const floor = __testExtractionBudgetLadder(10);
assert.equal(floor.first, 128, 'a nonsense budget falls back to the floor');

// --- 5. The archived original text and the model-initiated lookup are a cache and a supplement.
// Canonical memory must never read either. If it ever does, memory has started depending on a copy of
// the transcript, or on the model choosing to speak — which is the AIRP failure in a different costume.
const { readFileSync } = await import('node:fs');
const coreSource = readFileSync(new URL('./memory-core.js', import.meta.url), 'utf8');
for (const forbidden of ['cold_turns', 'scene_summaries', '查阅记忆', 'setting-']) {
  assert.equal(coreSource.includes(forbidden), false, 'canonical memory must not read ' + forbidden);
}
const coreImports = [...coreSource.matchAll(/from '(\.\/[^']+)'/g)].map(match => match[1]);
assert.deepEqual(coreImports, ['./v55-spine.js'], 'the canonical memory core depends on exactly one module: the deterministic spine');

console.log('PASS v5.5 drift switches: the setting<->memory loop is switchable and the baseline scope is explicit');
