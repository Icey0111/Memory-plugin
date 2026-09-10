// Reliability regression suite for the review fixes: privacy filtering, extraction contract,
// memory-op schema bounds, hash-authoritative dense mapping, budget accounting, store guards.
import assert from 'node:assert/strict';
import { filterPrivateKnowledge } from './v55-finalizer.js';
import { parseExtractionResult } from './memory-extractor.js';
import { validateMemoryOp, normalizeStore, fuseHybridCandidates, diversifyCandidates } from './memory-core.js';
import { mapDenseSettingMetadata } from './setting-retriever.js';
import { installMetadataIntegrityForContext } from './v55-store-integrity.js';
import { assembleGenerationContext } from './context-assembler.js';
import {
  createSettingStore, createWorld, addSource, addRevision, addEntries,
  setActiveBaselineRevision, listEntriesForRevision,
} from './setting-store.js';
import { buildSettingIndexSnapshot } from './setting-index.js';
import { handleTauriVectorRequest, __testResetTauriVectorBackend, isNativeTauriTavern } from './v55-tauri-vector-backend.js';

// --- 1. private memory with XML-special characters must be removed, not merely reported as hidden ---
{
  const store = { memories: { secret: { id: 'secret', kind: 'knowledge', text: `O'Brien's vault code is 7391 & rising`, known_by: ['Alice'], known_by_ids: ['ent_alice'] } } };
  const current = `- [knowledge:secret] O'Brien's vault code is 7391 & rising\n- [state] visible`;
  const out = filterPrivateKnowledge('', current, store, { aliases: ['bob'], ids: ['ent_bob'] });
  assert.doesNotMatch(out.currentStateBlock, /7391/, 'escaped/raw mismatch must not leak a private line');
  assert.deepEqual(out.hiddenMemoryIds, ['secret']);
}

// --- 2. extraction contract: operations must be an array; missing fields are reported, not silently wiped ---
{
  assert.equal(parseExtractionResult('{"event_summary":"s","active_state":"a"}').ok, false, 'missing operations array must fail');
  const warned = parseExtractionResult('{"event_summary":"s","operations":[]}');
  assert.equal(warned.ok, true);
  assert.ok(warned.warnings.includes('missing active_state'));
  assert.ok(warned.warnings.includes('missing active_state') && warned.operations.length === 0);
  const dropped = parseExtractionResult('{"event_summary":"s","active_state":"a","operations":[{"op":"bogus"}]}');
  assert.equal(dropped.ok, true);
  assert.equal(dropped.droppedOperations, 1, 'discarded operations must be counted');
}

// --- 3. memory-op schema bounds are enforced at the write gate ---
{
  const tooLong = validateMemoryOp({ op: 'add', kind: 'state', text: 'x'.repeat(1201) });
  assert.ok(tooLong.some(e => /1200 characters/.test(e)));
  const tooMany = validateMemoryOp({ op: 'add', kind: 'state', text: 'ok', entities: Array.from({ length: 21 }, (_, i) => 'e' + i) });
  assert.ok(tooMany.some(e => /at most 20 items/.test(e)));
  assert.deepEqual(validateMemoryOp({ op: 'add', kind: 'state', text: 'ok' }), []);
}

// --- 4. dense metadata mapping must trust the hash over a possibly stale array index ---
{
  const snapshot = { chunks: [
    { chunk_id: 'c0', entry_id: 'A', vector_hash: 111 },
    { chunk_id: 'c1', entry_id: 'B', vector_hash: 222 },
  ] };
  const mapped = mapDenseSettingMetadata(snapshot, [{ hash: 222, index: 0, score: 0.9 }]);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].chunk.entry_id, 'B', 'hash must win over a stale index');
  const indexOnly = mapDenseSettingMetadata(snapshot, [{ index: 1, score: 0.5 }]);
  assert.equal(indexOnly[0].chunk.entry_id, 'B', 'index remains the fallback when no hash is given');
}

// --- 5. null `order` must sort consistently in list and index views ---
{
  let store = createSettingStore({ now: 1 });
  store = createWorld(store, { world_id: 'w', name: 'W' }, { now: 2 }).store;
  store = addSource(store, { source_id: 's', world_id: 'w', format: 'worldbook_json', content_hash: 's', raw_payload: '{}' }, { now: 3 }).store;
  store = addRevision(store, { revision_id: 'rev', world_id: 'w', source_id: 's', revision_label: 'v', revision_kind: 'baseline' }, { now: 4 }).store;
  store = addEntries(store, [
    { entry_id: 'e_null', world_id: 'w', source_id: 's', revision_id: 'rev', source_entry_id: 0, title: 'N', content: 'null order', keys: [], order: null, content_hash: 'hn' },
    { entry_id: 'e_five', world_id: 'w', source_id: 's', revision_id: 'rev', source_entry_id: 1, title: 'F', content: 'five order', keys: [], order: 5, content_hash: 'hf' },
  ], { now: 5 }).store;
  store = setActiveBaselineRevision(store, 'w', 'rev', { now: 6 });
  assert.deepEqual(listEntriesForRevision(store, 'rev').map(e => e.entry_id), ['e_five', 'e_null']);
  const snapshot = buildSettingIndexSnapshot(store, { maxChars: 400 });
  assert.equal(snapshot.chunks[0].entry_id, 'e_five', 'index view must agree with the list view about null order');
}

// --- 6. Object.prototype key names must not defeat id uniqueness checks ---
{
  let store = createSettingStore({ now: 1 });
  store = createWorld(store, { world_id: 'constructor', name: 'C' }, { now: 2 }).store;
  assert.ok(Object.prototype.hasOwnProperty.call(store.worlds, 'constructor'));
  const added = addSource(store, { source_id: 's1', world_id: 'constructor', format: 'worldbook_json', content_hash: 'h', raw_payload: '{}' }, { now: 3 });
  assert.ok(added.store.sources.s1);
}

// --- 7. store integrity install reports failure instead of claiming success ---
{
  const locked = {};
  Object.defineProperty(locked, 'aetheriaUnifiedMemoryV54', { configurable: false, enumerable: true, writable: true, value: {} });
  assert.equal(installMetadataIntegrityForContext({ chatMetadata: locked }), false);
  assert.equal(installMetadataIntegrityForContext({ chatMetadata: {} }), true);
}

// --- 8. evidence-bearing history rows are admitted instead of being dropped by the probe ---
{
  const bundle = assembleGenerationContext({
    historyResults: [{ memory: { id: 'h', kind: 'knowledge', status: 'active', importance: 'high', text: 'x'.repeat(200), evidence_excerpt: 'y'.repeat(400) } }],
    maxReferenceChars: 4000,
    maxCurrentStateChars: 1000,
    hostContextBudget: 8192,
    includeEvidence: true,
  });
  assert.deepEqual(bundle.diagnostics.memoryIds, ['h']);
  assert.match(bundle.referenceBlock, /<evidence>/);
  assert.ok(bundle.referenceBlock.length <= 4000);
}

// --- 9. pure recall helpers tolerate malformed candidate entries ---
{
  const memory = { id: 'a', kind: 'state', status: 'active', text: 'alpha', entities: [], topics: [] };
  const fused = fuseHybridCandidates({ memories: { a: memory } }, [[memory, null]], [], {
    rrfK: 60, denseWeights: [1], lexicalWeight: 0.4, denseGate: true, currentMessage: 10,
  });
  assert.ok(Array.isArray(fused) && fused.length === 1);
  const diversified = diversifyCandidates([{ memory, score: 1 }, null, { score: 2 }], { finalCount: 5, lambda: 0.7 });
  assert.equal(diversified.length, 1);
  const normalized = normalizeStore({ memories: [], slots: [] });
  assert.deepEqual(Object.keys(normalized.memories), []);
  assert.deepEqual(Object.keys(normalized.slots), []);
}

// --- 10. a Tauri extension-store read failure must not look like an empty collection ---
{
  __testResetTauriVectorBackend();
  globalThis.__TAURITAVERN__ = {
    ready: Promise.resolve(),
    api: { extension: { store: {
      tryGetJson: async () => { throw new Error('store unavailable'); },
      setJson: async () => true,
      deleteJson: async () => true,
    } } },
  };
  assert.equal(isNativeTauriTavern(), true);
  let status = 'threw';
  try {
    const response = await handleTauriVectorRequest('list', { collectionId: 'c1' }, { apiUrl: 'https://api.jina.ai', model: 'm', secretId: 's' }, async () => { throw new Error('no network'); });
    status = response ? response.status : 'null';
  } catch { status = 'threw'; }
  assert.notEqual(status, 200, 'a failed store read must not surface as a successful list');
  delete globalThis.__TAURITAVERN__;
  __testResetTauriVectorBackend();
}

console.log('PASS reliability fixes: privacy filter, extraction contract, op bounds, hash-first dense mapping, ordering, guards, budget, Tauri store errors');