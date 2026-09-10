// Aetheria Unified Memory v5.5 — memory quality metrics (plan §3 A8).
//
// v55-metrics.js meters COST: background model calls and estimated tokens. This module measures the
// thing the plan actually gates on — whether memory stayed good. Four numbers, all computable
// offline from the store alone:
//
//   key_retention    the mandatory (never-drop) set survives the injection budget
//   causal_recall    a probe built from the spine can still be answered from memory
//   causal_injected  the same probe is answered by what actually reached the prompt this turn
//   compression      resident memory tokens / raw dialogue tokens, per floor count
//
// Honesty note: causal_recall is a LOWER BOUND on the plan's T-Causal. It proves the answer is still
// present in memory, not that a reader would use it. The gap between causal_recall and
// causal_injected is the number that matters for injection ratio (A5): facts that exist in memory
// but never reached the model.

import { factHistory, openSpine } from './v55-spine.js';
import { estimateTokens } from './v55-tokenizer.js';

export const QUALITY_METRICS_VERSION = 1;

// A probe counts as answerable when the memory view contains this many leading characters of the
// expected text. Long records are truncated on injection, so a full-string match would report an
// unreachable bar; a very short prefix would count "the cat" as an answer to everything.
export const PROBE_MATCH_CHARS = 32;

function clean(value, max = 4000) {
    return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function collapse(value) {
    return clean(value, 200000).replace(/\s+/g, ' ').trim();
}

function activeMemories(store) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    return Object.values(memories).filter(memory => memory && memory.status === 'active' && memory.text);
}

/** 1. Key retention: how much of the never-drop set survived the rendered block. */
export function mandatoryRetention(renderedBlock, mandatoryRows) {
    const block = collapse(renderedBlock);
    const rows = Array.isArray(mandatoryRows) ? mandatoryRows.filter(row => row && row.text) : [];
    const missing = [];
    for (const row of rows) {
        const needle = collapse(row.text).slice(0, PROBE_MATCH_CHARS);
        if (!needle || !block.includes(needle)) missing.push(String(row.id || row.slot || needle));
    }
    const total = rows.length;
    const kept = total - missing.length;
    return { total, kept, rate: total ? kept / total : 1, missing };
}

/** 2. Injection accounting: what each layer costs the prompt. */
export function injectionBreakdown({ referenceBlock = '', currentStateBlock = '', spineBlock = '' } = {}) {
    const reference = estimateTokens(String(referenceBlock || ''));
    const currentState = estimateTokens(String(currentStateBlock || ''));
    const spine = estimateTokens(String(spineBlock || ''));
    return {
        reference_tokens: reference,
        current_state_tokens: currentState,
        spine_tokens: spine,
        injected_tokens: reference + currentState,
        combined_tokens: reference + currentState + spine,
    };
}

/** 3. Compression: resident memory tokens against the raw dialogue they stand for. */
export function compressionPoint({ memories = [], dialogueTexts = [], floors = 0 } = {}) {
    const memoryTokens = estimateTokens((Array.isArray(memories) ? memories : []).map(memory => clean(memory?.text, 2000)).join('\n'));
    const rawTokens = estimateTokens((Array.isArray(dialogueTexts) ? dialogueTexts : []).map(text => clean(text, 200000)).join('\n'));
    return {
        floors: Number(floors) || (Array.isArray(dialogueTexts) ? dialogueTexts.length : 0),
        memory_tokens: memoryTokens,
        raw_tokens: rawTokens,
        ratio: rawTokens ? memoryTokens / rawTokens : 0,
        factor: memoryTokens ? rawTokens / memoryTokens : 0,
    };
}

/** The compression curve the plan asks for: is the ratio constant, or does it fall as floors grow? */
export function compressionSeries({ memories = [], dialogueTextsPerFloor = [], everyFloors = 10 } = {}) {
    const floors = Array.isArray(dialogueTextsPerFloor) ? dialogueTextsPerFloor.length : 0;
    const step = Math.max(1, Number(everyFloors) || 10);
    const out = [];
    for (let at = step; at <= floors; at += step) {
        out.push(compressionPoint({ memories, dialogueTexts: dialogueTextsPerFloor.slice(0, at), floors: at }));
    }
    if (!out.length && floors) out.push(compressionPoint({ memories, dialogueTexts: dialogueTextsPerFloor, floors }));
    return out;
}

/** 4. Causal probes, generated from the spine so they are never hand-written or model-made. */
export function buildCausalProbes(store, { limit = 60 } = {}) {
    const spine = openSpine(store, false);
    if (!spine) return [];
    const probes = [];
    const cap = Math.max(0, Number(limit) || 0);
    for (const slot of Object.keys(spine.by_slot)) {
        if (probes.length >= cap) break;
        const history = factHistory(store, slot).filter(row => row && row.text);
        if (!history.length) continue;
        const current = [...history].reverse().find(row => row.status === 'active');
        if (!current) continue;
        probes.push({
            id: 'c:' + slot,
            slot,
            kind: 'current',
            question: '槽位「' + slot + '」现在的值是什么？',
            expected: clean(current.text, 2000),
        });
        if (probes.length >= cap) break;
        const replaced = history.filter(row => row.id !== current.id).pop();
        if (replaced) {
            probes.push({
                id: 's:' + slot,
                slot,
                kind: 'superseded',
                question: '槽位「' + slot + '」在被替换之前是什么？',
                expected: clean(replaced.text, 2000),
            });
        }
        if (probes.length >= cap) break;
        const firstId = spine.first_by_slot[slot];
        const first = firstId ? history.find(row => row.id === firstId) : history[0];
        if (first && first.id !== current.id && first.text !== replaced?.text) {
            probes.push({
                id: 'f:' + slot,
                slot,
                kind: 'first',
                question: '槽位「' + slot + '」最早是什么？',
                expected: clean(first.text, 2000),
            });
        }
    }
    return probes.slice(0, cap);
}

/**
 * The text a reader gets. 'canonical' is everything the memory system owns (including superseded
 * values, which is where the change chain lives). 'injected' is only what reached the prompt.
 */
export function buildMemoryCorpus(store, { scope = 'canonical', injectedText = '' } = {}) {
    if (scope === 'injected') return collapse(injectedText);
    const memoryTexts = Object.values(store?.memories && typeof store.memories === 'object' ? store.memories : {})
        .filter(memory => memory && memory.text)
        .map(memory => clean(memory.text, 4000));
    return collapse(memoryTexts.join('\n'));
}

export function scoreCausalProbes(store, probes, { scope = 'canonical', injectedText = '' } = {}) {
    const corpus = buildMemoryCorpus(store, { scope, injectedText });
    const list = Array.isArray(probes) ? probes : [];
    const misses = [];
    for (const probe of list) {
        const needle = collapse(probe?.expected).slice(0, PROBE_MATCH_CHARS);
        if (!needle || !corpus.includes(needle)) misses.push({ id: probe?.id, slot: probe?.slot, kind: probe?.kind });
    }
    const total = list.length;
    const hit = total - misses.length;
    return { total, hit, rate: total ? hit / total : 1, misses };
}

/** One call that answers all four A8 numbers for the current turn. */
export function qualityReport({ store, rendered = '', injectedText = '', mandatory = [], dialogueTextsPerFloor = [], everyFloors = 10, probeLimit = 60 } = {}) {
    const probes = buildCausalProbes(store, { limit: probeLimit });
    const canonical = scoreCausalProbes(store, probes, { scope: 'canonical' });
    const injected = scoreCausalProbes(store, probes, { scope: 'injected', injectedText });
    const memories = activeMemories(store);
    const series = compressionSeries({ memories, dialogueTextsPerFloor, everyFloors });
    return {
        version: QUALITY_METRICS_VERSION,
        key_retention: mandatoryRetention(rendered, mandatory),
        causal_recall: canonical,
        causal_injected: injected,
        causal_gap: canonical.hit - injected.hit,
        compression: series,
        compression_latest: series.length ? series[series.length - 1] : null,
    };
}
