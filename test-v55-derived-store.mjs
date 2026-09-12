// Derived chat state (cold snapshots, scene locators, fold audit, diagnostics) belongs outside the
// chat file. The two rules this test exists for:
//   1. an unhydrated store looks exactly like an empty one, so writing it would erase the real record;
//   2. derived keys are only stripped from chat_metadata after the external write succeeded.
import assert from 'node:assert/strict';
import { decodeRecordMap } from './memory-core.js';
import { readNarrativeReport } from './narrative-runtime.js';
import {
  DERIVED_KEYS, __resetDerivedStateForTests, __setDerivedBackendForTests, awaitDerivedReady,
  derivedReady, ensureDerivedHydrated, extractDerived, hasDerivedBackend, installDerivedSerializationFilter, queueDerivedWrite,
} from './v55-derived-store.js';

const KEY = 'aetheriaUnifiedMemoryV54';

function memoryBackend(initial = null) {
  const data = new Map();
  if (initial) data.set(initial.key, initial.value);
  return {
    name: 'test-memory',
    durable: true,
    writes: [],
    reads: [],
    failWrites: false,
    async read(key) { this.reads.push(key); if (this.failWrites) throw new Error('backend down'); return data.get(key) ?? null; },
    async write(key, value) { if (this.failWrites) throw new Error('backend down'); this.writes.push({ key, value }); data.set(key, JSON.parse(JSON.stringify(value))); },
    async remove(key) { data.delete(key); },
    peek(key) { return data.get(key); },
  };
}

function makeCtx(store, chatId) {
  return { chatId, chatMetadata: { [KEY]: store }, eventTypes: {}, eventSource: { on: () => {} } };
}

const fullStore = {
  version: '5.4', memories: { m1: { id: 'm1', text: 'fact' } }, slots: { s: 'm1' },
  extractions: { x: { source_key: 'x' } }, hierarchical_summaries: { version: 3, level1: [{ id: 'l1' }] },
  floor_folds: { version: 2, hidden: { 0: { summary_id: 'l1' } } },
  cold_turns: { version: 1, turns: { k1: { source_key: 'k1' } }, order: ['k1'], chars: 10 },
  scene_summaries: [{ scene_id: 'sc1' }],
  last_extraction_debug: { status: 'ok' },
  last_errors: ['x'],
  entity_registry: { e1: { entity_id: 'e1' } },
  provenance_registry: { p1: {} },
  vector: { collection_id: 'c1', stale: false },
  baseline: { vector: { collection_id: 'b1' } },
  runtime_identity: { branch_id: 'br' },
};

// --- extraction ---------------------------------------------------------------------------------
const extracted = extractDerived(fullStore);
assert.deepEqual(Object.keys(extracted.keys).sort(), DERIVED_KEYS.filter(k => k in fullStore).sort());
// The fact set is a projection of the replay log: memories and slots are exactly
// buildCanonicalState(extractions), and the summary tree is written by no module any more. They are
// derived, so the external record owns them; the log they are rebuilt from stays canonical.
assert.ok(extracted.keys.memories, 'the replayable fact set is derived');
assert.ok(extracted.keys.slots, 'and the slot map it projects');
assert.ok(extracted.keys.hierarchical_summaries, 'and the retired summary tree');
assert.equal(extracted.keys.extractions, undefined, 'the replay log stays canonical: the fact set is rebuilt from it');
assert.equal(extracted.keys.entity_registry, undefined, 'losing the entity registry would fragment identity');
assert.equal(extracted.keys.vector, undefined, 'the vector pointer is tiny and portability matters more');
assert.equal(extracted.keys.floor_folds.hidden['0'].summary_id, 'l1');

// --- before hydration nothing is stripped and nothing is written ---------------------------------
__resetDerivedStateForTests();
const backend = memoryBackend();
__setDerivedBackendForTests(backend);
let ctx = makeCtx(structuredClone(fullStore), 'ChatOne');
assert.equal(derivedReady(ctx), false);
assert.equal(JSON.parse(JSON.stringify(ctx.chatMetadata[KEY])).cold_turns.turns.k1.source_key, 'k1', 'before hydration the chat file itself keeps the derived keys');
assert.equal(queueDerivedWrite(ctx, ctx.chatMetadata[KEY]), false, 'a pre-hydration write must be refused');
assert.equal(backend.writes.length, 0, 'a pre-hydration write must never reach the backend');

// --- migration: the keys are in the chat, the backend is empty ------------------------------------
assert.equal(await ensureDerivedHydrated(ctx), true);
assert.equal(backend.writes.length, 1, 'the chat-embedded copy is migrated out');
assert.equal(backend.writes[0].value.keys.cold_turns.turns.k1.source_key, 'k1');
assert.equal(derivedReady(ctx), true);
const liveStore = ctx.chatMetadata[KEY];
installDerivedSerializationFilter(liveStore, ctx);
// The keys must stay readable: every runtime reader (the fold audit, the cold snapshot, the scene
// locators) reads the store object, so removing them from memory silently disables those features.
assert.equal(Object.keys(liveStore.cold_turns.turns).length, 1, 'the derived keys stay readable in memory');
assert.equal(Object.keys(liveStore.floor_folds.hidden).length, 1);
assert.equal(liveStore.memories.m1.text, 'fact', 'the fact set stays readable in memory');
assert.equal(Object.keys(liveStore.slots).length, 1);
// ...but they must not reach the chat file. SillyTavern serialises with JSON.stringify, which honours
// toJSON.
const serialised = JSON.parse(JSON.stringify(liveStore));
assert.equal(serialised.cold_turns, undefined, 'the derived keys must not serialise into the chat');
assert.equal(serialised.floor_folds, undefined);
assert.equal(serialised.scene_summaries, undefined);
assert.ok(serialised.derived_store && serialised.derived_store.backend === 'test-memory', 'a small pointer replaces them');
assert.equal(serialised.memories, undefined, 'the replayable fact set leaves the chat file once the record owns it');
assert.equal(serialised.slots, undefined);
assert.equal(serialised.hierarchical_summaries, undefined);
// What stays is the DATA the fact set is rebuilt from, written column-encoded (one copy of each field
// name per map). The decoder is the proof that it survives: \`normalizeStore\` runs it on load, so this
// assert is also the check that a chat written by this version loads with the records it wrote.
assert.equal(serialised.extractions.__columns, 1, 'the replay log is written as columns');
assert.equal(JSON.stringify(serialised.extractions).includes('"source_key"'), true, 'the field name is written once, not once per record');
const roundTripped = decodeRecordMap(serialised.extractions);
assert.equal(roundTripped.x.source_key, 'x', 'transactions stay in the chat');
assert.equal(serialised.entity_registry.e1.entity_id, 'e1', 'the entity registry stays in the chat');
assert.equal(Object.keys(liveStore).includes('toJSON'), false, 'the filter itself must not become chat data');
const projected = serialised;

// --- a reload: the chat no longer carries the keys, the backend does ------------------------------
__resetDerivedStateForTests();
__setDerivedBackendForTests(backend);
const slim = { ...projected };
delete slim.derived_store;
ctx = makeCtx(slim, 'ChatOne');
assert.equal(await ensureDerivedHydrated(ctx), true);
assert.equal(ctx.chatMetadata[KEY].cold_turns.turns.k1.source_key, 'k1', 'hydration restores the cold snapshot');
assert.equal(ctx.chatMetadata[KEY].floor_folds.hidden['0'].summary_id, 'l1', 'hydration restores the fold audit');
assert.equal(ctx.chatMetadata[KEY].scene_summaries[0].scene_id, 'sc1');

// --- writes are allowed once hydrated -------------------------------------------------------------
ctx.chatMetadata[KEY].cold_turns.turns.k2 = { source_key: 'k2' };
assert.equal(queueDerivedWrite(ctx, ctx.chatMetadata[KEY], { immediate: true }), true);
await new Promise(r => setTimeout(r, 20));
assert.equal(backend.writes.length, 2);
assert.equal(backend.writes[1].value.keys.cold_turns.turns.k2.source_key, 'k2');

// --- a backend that cannot be reached must not strip the chat copy ---------------------------------
__resetDerivedStateForTests();
const down = memoryBackend();
down.failWrites = true;
__setDerivedBackendForTests(down);
ctx = makeCtx(structuredClone(fullStore), 'ChatTwo');
assert.equal(await ensureDerivedHydrated(ctx), false, 'a failed migration must report failure');
assert.equal(derivedReady(ctx), false);
assert.equal(JSON.parse(JSON.stringify(ctx.chatMetadata[KEY])).cold_turns.turns.k1.source_key, 'k1', 'the chat keeps its copy when the backend is down');
assert.equal(ctx.chatMetadata[KEY].cold_turns.turns.k1.source_key, 'k1');

// --- a new chat with nothing derived yet still hydrates and stays writable ------------------------
__resetDerivedStateForTests();
const fresh = memoryBackend();
__setDerivedBackendForTests(fresh);
ctx = makeCtx({ version: '5.4', memories: {} }, 'ChatThree');
assert.equal(await ensureDerivedHydrated(ctx), true);
assert.equal(derivedReady(ctx), true);
ctx.chatMetadata[KEY].last_errors = ['boom'];
assert.equal(queueDerivedWrite(ctx, ctx.chatMetadata[KEY], { immediate: true }), true);
await new Promise(r => setTimeout(r, 20));
assert.equal(fresh.writes.at(-1).value.keys.last_errors[0], 'boom');

// --- the bounded await never hangs -----------------------------------------------------------------
__resetDerivedStateForTests();
__setDerivedBackendForTests({
  name: 'hanging', durable: true,
  read: () => new Promise(() => {}),
  write: () => new Promise(() => {}),
  remove: () => new Promise(() => {}),
});
ctx = makeCtx(structuredClone(fullStore), 'ChatFour');
const started = Date.now();
const ready = await awaitDerivedReady(ctx, 120);
assert.equal(ready, false, 'a hanging backend must time out rather than stall the interceptor');
assert.ok(Date.now() - started < 1000, 'the bounded await must respect its budget');
// --- no backend at all: the chat file stays the owner ---------------------------------------------
// Stripping derived keys with nowhere to put them would silently delete the cold snapshot, the fold
// audit and every diagnostic. Without a durable backend the projection must be a no-op.
__resetDerivedStateForTests();
ctx = makeCtx(structuredClone(fullStore), 'ChatFive');
assert.equal(hasDerivedBackend(), false);
assert.equal(await ensureDerivedHydrated(ctx), false, 'no backend means nothing is hydrated');
assert.equal(derivedReady(ctx), false);
assert.equal(JSON.parse(JSON.stringify(ctx.chatMetadata[KEY])).cold_turns.turns.k1.source_key, 'k1', 'without a backend the derived keys stay in the chat');
assert.equal(ctx.chatMetadata[KEY].cold_turns.turns.k1.source_key, 'k1');
assert.equal(await awaitDerivedReady(ctx, 5000), false, 'the bounded await must not wait when there is no backend');
// --- a diagnostics read must not create a derived key ---------------------------------------------
// The audit and the tree history live in the external record. A read that lazily created them would put
// an empty object back into the chat store, and the next save would write it into the chat file — which
// is exactly what a live diagnostics probe did before this was fixed.
__resetDerivedStateForTests();
const bare = { version: '5.4', memories: {} };
const bareCtx = { chatMetadata: { [KEY]: bare }, chat: [], extensionSettings: { [KEY]: { summary_fold_hidden_floors: true } } };
const report = readNarrativeReport(bareCtx);
assert.equal(report.messages, 0);
assert.equal(report.summary_valid, false);
assert.equal(report.folded_rows, 0);
assert.equal('raw_history' in bare, false, 'the narrative report must not create the original-text archive');
assert.equal('narrative_summary' in bare, false, 'nor a summary');
assert.equal('floor_folds' in bare, false, 'nor the retired fold audit');
// --- a write must never drop a key it does not carry ---------------------------------------------
// A reloaded store carries fewer keys than the record does. Replacing the record wholesale erased the
// cold snapshot and the fold audit on the first write after every reload.
__resetDerivedStateForTests();
const monotonic = memoryBackend();
__setDerivedBackendForTests(monotonic);
ctx = makeCtx(structuredClone(fullStore), 'ChatSix');
assert.equal(await ensureDerivedHydrated(ctx), true);
ctx.chatMetadata[KEY].cold_turns.turns.k9 = { source_key: 'k9' };
assert.equal(queueDerivedWrite(ctx, ctx.chatMetadata[KEY], { immediate: true }), true);
await new Promise(r => setTimeout(r, 20));
delete ctx.chatMetadata[KEY].cold_turns;
delete ctx.chatMetadata[KEY].floor_folds;
assert.equal(queueDerivedWrite(ctx, ctx.chatMetadata[KEY], { immediate: true }), true);
await new Promise(r => setTimeout(r, 20));
const lastRecord = monotonic.writes.at(-1).value.keys;
assert.equal(lastRecord.cold_turns.turns.k9.source_key, 'k9', 'a write must not drop a key it does not carry');
assert.equal(Object.keys(lastRecord.floor_folds.hidden).length, 1, 'nor the fold audit');
console.log('PASS v5.5 derived store: derived chat state lives outside the chat file and never overwrites a good record');
