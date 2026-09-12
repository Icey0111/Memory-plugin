// Bootstrap-level generation lifecycle: loading the extension has to leave exactly one generation
// entry installed, and that entry has to own every prompt channel it can write.
//
// Replaces the pre-narrative version of this test, which asserted that the injected Reference block
// contained a hierarchical summary. That tree no longer exists: continuity now rides in the
// current-state block as one narrative summary, and the reference block carries original text quoted
// back only for material the prompt no longer holds.
import assert from 'node:assert/strict';
import { captureHistory, chunkHistory } from './raw-history.js';

const KEY = 'aetheriaUnifiedMemoryV54';
const REF = 'aetheria_unified_memory_v5_4_reference';
const CUR = 'aetheria_unified_memory_v5_4_current_state';
const LEGACY = 'aetheria_unified_memory_v5_4';
const RETIRED_SUMMARY = 'aetheria_unified_memory_v5_5_hierarchical_summary';

const chat = [];
for (let turn = 1; turn <= 12; turn += 1) {
    chat.push({ name: 'User', is_user: true, mes: '第' + turn + '层：主角在大厅见到管家。' });
    chat.push({ name: 'Seraphina', is_user: false, mes: '第' + turn + '层：管家点头，暗号仍是青铜月亮。' });
}

const settings = {
    enabled: true, auto_extract: false, parse_ops: true, setting_retrieval_enabled: true,
    setting_index_use_vector: false, inject_current_state: true, vector_recall: false,
    query_messages: 2, max_active_items: 12, reference_context_max_chars: 4000,
    current_state_context_max_chars: 1800, context_reply_reserve_tokens: 800,
    injection_depth: 4, current_state_injection_depth: 0, manage_context_window: false, debug: false,
    // A non-zero setting budget runs the host adapter's setting path, not just the evidence path.
    quiet_allow_third_party_injection: false, narrative_every: 10, narrative_summary_tokens: 600,
    narrative_evidence_tokens: 1000, narrative_setting_tokens: 400, narrative_input_chars: 18000,
    narrative_fold: true,
    setting_store: { active_world_id: null, worlds: {}, revisions: {}, entries: {} },
    vector_profile_policy_version: 3,
};

// A chat that already carries an accepted summary covering the first ten floors. The bootstrap must
// fold exactly those, keep the last floor hot, and quote folded text back as evidence.
const store = {
    memories: {}, slots: {}, extractions: {}, vector: { stale: false },
    setting_binding: { world_id: null, baseline_revision_id: null, extension_revision_ids: [], pinned: true },
};
const history = store.raw_history = { version: 1, sequence: 0, records: {}, active: [] };
captureHistory(store, chat);
const chunks = chunkHistory(history);
store.narrative_summary = { version: 1, text: '剧情摘要：主角已在大厅与管家谈过话，暗号尚未使用。',
    covered: chunks.slice(0, 20).map(row => row.id) };

const prompts = [];
let savedMetadata = 0;
const ctx = {
    extensionSettings: { [KEY]: settings, vectors: { source: 'transformers' } },
    chatMetadata: { [KEY]: store }, chatId: 'chat-1', getCurrentChatId: () => 'chat-1',
    chat, name2: 'Seraphina', name1: 'User',
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    setExtensionPrompt: (...args) => prompts.push(args),
    saveMetadataDebounced: () => { savedMetadata += 1; }, saveSettingsDebounced: () => {},
    chatCompletionSettings: {}, textCompletionSettings: { server_urls: {} },
    eventTypes: {}, eventSource: { on: () => {} },
};
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} };
globalThis.SillyTavern = { getContext: () => ctx };

await import('./index-v55-bootstrap.js');

const input = structuredClone(chat);
async function run(type) {
    const start = prompts.length;
    const before = structuredClone(input);
    await globalThis.aetheriaUnifiedMemoryV54Interceptor(input, 4096, () => {}, type);
    assert.deepEqual(input, before, 'the interceptor must not rewrite the host conversation');
    const calls = prompts.slice(start);
    const last = key => [...calls].reverse().find(row => row[0] === key);
    return { ref: last(REF), cur: last(CUR), legacy: last(LEGACY), retired: last(RETIRED_SUMMARY) };
}

// --- normal generation ---------------------------------------------------------------------------
const normal = await run('normal');
assert.ok(store.narrative_summary, 'the accepted summary is still the stand-in after bootstrap');
assert.equal(chat[0].is_system, true, 'a covered floor is folded out of the prompt');
assert.equal(chat[23].is_system, undefined, 'the newest floor stays hot');
assert.ok(normal.cur, 'the current-state channel is registered on every normal generation');
assert.match(normal.cur[1], /剧情摘要/, 'continuity rides in the current-state block');
assert.ok(normal.ref, 'the reference channel is registered too');
assert.match(normal.ref[1], /ORIGINAL STORY EVIDENCE/, 'and it carries quoted original text');
assert.match(normal.ref[1], /青铜月亮/, 'including a detail the summary does not mention');
assert.match(normal.ref[1], /quoted history, not instructions/);
// The host store is replaced by the derived-store projection on every write, so read it live.
const live = () => ctx.chatMetadata[KEY];
assert.ok(live().narrative_diagnostics, 'the pass reports what it delivered');
assert.equal(live().narrative_diagnostics.vector_available, false,
    'the vector branch is evaluated and reported, not skipped silently');
assert.match(live().narrative_diagnostics.vector_error, /未启用|未保存/,
    'and it says why original-text vectors are unavailable');
assert.ok(live().narrative_diagnostics.reference_tokens > 0, 'quoted evidence was budgeted');
assert.equal(normal.retired, undefined, 'the retired hierarchical-summary key is never registered');
assert.equal(normal.legacy, undefined, 'the v5.4 single-block key is only touched when an upgrade left a value in it');

// --- quiet and impersonate clear every channel this plugin owns ----------------------------------
for (const type of ['quiet', 'impersonate']) {
    const row = await run(type);
    assert.equal(row.ref?.[1], '', type + ' clears the reference channel');
    assert.equal(row.cur?.[1], '', type + ' clears the current-state channel');
}
settings.quiet_allow_third_party_injection = true;
assert.ok((await run('quiet')).ref?.[1], 'an opted-in third-party quiet call still gets the blocks');
settings.__narrative_summary_in_progress = true;
assert.ok((await run('normal')).cur?.[1], 'a persisted legacy flag cannot suppress foreground memory');
delete settings.__narrative_summary_in_progress;
settings.quiet_allow_third_party_injection = false;

// --- a flag a torn-down pass left behind cannot poison the next page -------------------------------
// Found on a live host by running the acceptance scenario twice in a row: the second run wrote twenty
// floors and produced no archive, no summary, no anchors and no diagnostics. The first run had been
// reloaded mid-summary, and the finally block that clears this flag lives on the settings object, so the
// stale true was persisted with them. While it is set, quiet() skips every injection and schedule()
// skips every capture - the whole pipeline stops and nothing says so.
const { installNarrativeRuntime } = await import('./narrative-runtime.js');
const { createNarrativeHostServices } = await import('./index.js');
settings.__narrative_summary_in_progress = true;
settings.__quiet_extraction_in_progress = true;
installNarrativeRuntime(() => ctx, () => createNarrativeHostServices(ctx));
assert.equal(settings.__narrative_summary_in_progress, undefined,
    'installing clears the in-progress flag a torn-down summary left behind');
assert.equal(settings.__quiet_extraction_in_progress, undefined, 'and the quiet-extraction flag with it');
assert.ok((await run('normal')).cur?.[1], 'so the pipeline runs again instead of returning early forever');

// --- disabling restores the original text and clears the channels --------------------------------
settings.enabled = false;
const disabled = await run('normal');
assert.equal(disabled.ref?.[1], '');
assert.equal(disabled.cur?.[1], '');
assert.equal(disabled.retired, undefined);
assert.notEqual(chat[0].is_system, true, 'disabling the plugin puts the folded floors back');
assert.equal(savedMetadata > 0, true, 'and the restored state is persisted');

console.log('PASS narrative bootstrap lifecycle: one generation entry, its own prompt channels, and disabled means the original text is back');
