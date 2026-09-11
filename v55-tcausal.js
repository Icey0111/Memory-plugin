// Aetheria Unified Memory v5.5 — T-Causal: the acceptance instrument the plan gates everything on.
//
// MEMORY_PLAN_2026.md section 6 states the precondition in as many words:
//
//   "P1 之前的硬性前提：先把 T-Causal 问答集做出来。没有它，后面所有改动都无法判断是否真的'没丢逻辑'。"
//
// and section 1 defines what it must be: a reader who sees only the memory, never the transcript, is
// asked "why is it like this now?", "who did this first?", "who still does not know?" - and the accuracy
// is the score for whether the logic survived.
//
// What existed instead was v55-quality-metrics.js's causal probes: a 32-character substring match of one
// expected fragment against the memory text. That is a useful lower bound, but it cannot express the
// three question types and it has no way to say "and this must NOT be answered", which is the failure
// that matters most for I1 (canonical memory must not be overwritten by a later summary) and for
// supersession: presenting a replaced value as the current one is a wrong answer even when the old text
// is still present somewhere.
//
// So a case here carries three things: what must be answerable, what must not, and which memory must not
// be rendered as live. Cases are either authored (the shipped fixture) or generated from the spine, so
// the same scorer works on a hand-built store in a unit test and on a live chat after a run.

import { factHistory, openSpine } from './v55-spine.js';

export const TCAUSAL_VERSION = 1;
export const TCAUSAL_KINDS = Object.freeze(['why', 'who_first', 'who_unknown', 'no_stale']);
export const TCAUSAL_MATCH_CHARS = 24;

function clean(value, max = 4000) {
    return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function collapse(value) {
    return clean(value, 200000).replace(/\s+/g, ' ').trim();
}

function memoryList(store) {
    const memories = store?.memories && typeof store.memories === 'object' ? store.memories : {};
    return Object.values(memories).filter(memory => memory && memory.text);
}

/**
 * The corpus a case is scored against.
 *
 * Two views, because "what is true now" and "how did it get like this" are different questions and a
 * single bag of text cannot answer both:
 *
 *   current - live memories only. A superseded or invalidated value is NOT in it, which is what makes
 *             the anti-staleness check meaningful: an answer that cites a replaced value as current has
 *             to fail.
 *   history - live memories, retired records, and the previous values the spine preserved for in-place
 *             updates. This is the corpus a "why" question is allowed to draw on: explaining a change
 *             requires both endpoints.
 *
 * `forbidsText` is always checked against the current view, whatever corpus the case's requirements use.
 */
export function tcausalCorpus(store, { scope = 'canonical', injectedText = '', view = 'current' } = {}) {
    if (scope === 'injected') return collapse(injectedText);
    const live = memoryList(store).filter(memory => memory.status === 'active');
    if (view === 'current') return collapse(live.map(memory => clean(memory.text, 2000)).join('\n'));
    const retired = memoryList(store).filter(memory => memory.status !== 'active');
    const spine = openSpine(store, false);
    const previous = spine ? spine.nodes.filter(node => node.previous).map(node => node.previous) : [];
    return collapse([...live, ...retired].map(memory => clean(memory.text, 2000)).concat(previous).join('\n'));
}

/** Which view a question type answers from. "why" and "who first" are historical by nature. */
export function tcausalViewFor(kind) {
    return kind === 'why' || kind === 'who_first' ? 'history' : 'current';
}

/**
 * Generate cases from the spine, oldest first. Deterministic and bounded; every generated case is
 * answerable by construction, so a miss is always a real failure of the memory layer that was asked.
 */
export function buildTcausalCases(store, { limit = 40 } = {}) {
    const spine = openSpine(store, false);
    const members = memoryList(store);
    const byId = new Map(members.map(memory => [memory.id, memory]));
    const cases = [];
    if (!spine) return cases;

    // why: a slot whose value was replaced. The current value must be answerable, and the replaced
    // record must not be rendered as a live memory row.
    for (const [slot, nodeIds] of Object.entries(spine.by_slot || {})) {
        if (cases.length >= limit) break;
        const history = factHistory(store, slot);
        if (history.length < 2 && !history.some(row => (row.previous || []).length)) continue;
        const currentId = store?.slots?.[slot] || null;
        const current = currentId ? byId.get(currentId) : history.filter(row => row.status === 'active').slice(-1)[0];
        if (!current || current.status !== 'active' || !current.text) continue;
        // Explaining "why is it like this now" needs BOTH endpoints: the value it is, and the value it
        // replaced. The spine keeps the replaced text even when `update` rewrote the record in place,
        // which is the whole reason it is stored there.
        const earlier = [...new Set(history.flatMap(row => Array.isArray(row.previous) ? row.previous : []))]
            .filter(text => text && text !== current.text).slice(0, 2);
        const stale = history.filter(row => row.id !== current.id).map(row => row.id);
        cases.push({
            id: 'why_' + slot,
            kind: 'why',
            slot,
            question: slot + ' 现在是什么？它是怎么变成现在这样的？',
            requiresText: [collapse(current.text).slice(0, TCAUSAL_MATCH_CHARS * 3), ...earlier.map(text => collapse(text).slice(0, TCAUSAL_MATCH_CHARS))],
            forbidsLiveMemoryId: stale,
            generated: true,
            changes: history.length + earlier.length,
            nodes: nodeIds.length,
        });
    }

    // who_first: the first memory that claimed a slot. Its text is the "who did this first" answer.
    for (const [slot, memoryId] of Object.entries(spine.first_by_slot || {})) {
        if (cases.length >= limit) break;
        const first = byId.get(memoryId);
        if (!first || !first.text) continue;
        cases.push({
            id: 'who_first_' + slot,
            kind: 'who_first',
            slot,
            question: '这件事谁先做的？' + slot,
            requiresText: [collapse(first.text).slice(0, TCAUSAL_MATCH_CHARS * 3)],
            forbidsLiveMemoryId: [],
            generated: true,
        });
    }

    // who_unknown: a knowledge record held by an explicit, incomplete set of knowers. The answer is the
    // record itself; a case is only generated when the holder set is narrower than the cast, which is
    // exactly the situation a reader gets wrong.
    for (const memory of members) {
        if (cases.length >= limit) break;
        if (memory.kind !== 'knowledge' || !Array.isArray(memory.known_by) || !memory.known_by.length) continue;
        cases.push({
            id: 'who_unknown_' + memory.id,
            kind: 'who_unknown',
            slot: memory.slot || null,
            question: '谁还不知道：' + collapse(memory.text).slice(0, 60),
            requiresText: [collapse(memory.text).slice(0, TCAUSAL_MATCH_CHARS * 3)],
            requiresKnownBy: memory.known_by.slice(0, 8),
            forbidsLiveMemoryId: [],
            generated: true,
        });
    }

    return cases.slice(0, Math.max(0, Number(limit) || 0));
}

/**
 * Score the cases.
 *
 * `scope` picks the corpus. A case is a hit only when every required fragment is answerable, and it is
 * a VIOLATION - a separate, worse outcome than a miss - when a forbidden fragment is answerable or a
 * memory that must not be live is rendered as a live row. Misses mean "this fact is no longer reachable";
 * violations mean "this memory now says something false", which is the failure the plan's I1 forbids.
 */
export function scoreTcausal(store, cases, { scope = 'canonical', injectedText = '', renderedBlock = '', available = null } = {}) {
    const list = Array.isArray(cases) ? cases : [];
    const measured = scope !== 'injected' || (available === null ? Boolean(collapse(injectedText)) : Boolean(available));
    if (!measured) {
        return { version: TCAUSAL_VERSION, scope, total: list.length, hit: null, rate: null, violations: 0, misses: [], by_kind: {}, measured: false };
    }
    const rendered = scope === 'injected' ? collapse(renderedBlock || injectedText) : '';
    // The current view answers "what is true"; the history view also answers "how did it get like this".
    const currentCorpus = scope === 'injected' ? rendered : tcausalCorpus(store, { scope, injectedText, view: 'current' });
    const historyCorpus = scope === 'injected' ? rendered : tcausalCorpus(store, { scope, injectedText, view: 'history' });
    // Authored cases cannot name a memory id: ids are derived from the message index, the op index and
    // the op body, so they change whenever a fixture changes. A slot plus a text prefix identifies the
    // same record and survives that.
    const resolveForbiddenLive = item => {
        const ids = (Array.isArray(item?.forbidsLiveMemoryId) ? item.forbidsLiveMemoryId : []).map(String);
        for (const ref of Array.isArray(item?.forbidsLiveSlotValue) ? item.forbidsLiveSlotValue : []) {
            const needle = collapse(ref?.text).slice(0, TCAUSAL_MATCH_CHARS);
            for (const memory of memoryList(store)) {
                if (ref?.slot !== undefined && memory.slot !== ref.slot) continue;
                if (needle && !collapse(memory.text).includes(needle)) continue;
                ids.push(String(memory.id));
            }
        }
        return ids;
    };
    const misses = [];
    const violations = [];
    const byKind = {};
    const bump = (kind, field) => {
        const row = byKind[kind] || (byKind[kind] = { total: 0, hit: 0, missed: 0, violated: 0 });
        row.total += 1;
        row[field] += 1;
    };
    for (const item of list) {
        const kind = String(item?.kind || 'why');
        const required = (Array.isArray(item?.requiresText) ? item.requiresText : [])
            .map(value => collapse(value).slice(0, TCAUSAL_MATCH_CHARS))
            .filter(Boolean);
        const corpus = (item?.view || tcausalViewFor(kind)) === 'history' ? historyCorpus : currentCorpus;
        const missing = required.filter(needle => !corpus.includes(needle));
        const forbidden = (Array.isArray(item?.forbidsText) ? item.forbidsText : [])
            .map(value => collapse(value).slice(0, TCAUSAL_MATCH_CHARS))
            .filter(Boolean);
        // Staleness is always judged against the current view: a retired value may legitimately appear in
        // a change chain, but it must never be answerable as the present state.
        const survived = forbidden.filter(needle => currentCorpus.includes(needle));
        const staleLive = resolveForbiddenLive(item).filter(id => rendered && rendered.includes('id="' + id + '"'));
        if (survived.length || staleLive.length) {
            violations.push({ id: item?.id, kind, survived, stale_live: staleLive });
            bump(kind, 'violated');
            continue;
        }
        if (missing.length) {
            misses.push({ id: item?.id, kind, missing });
            bump(kind, 'missed');
            continue;
        }
        bump(kind, 'hit');
    }
    const total = list.length;
    const hit = total - misses.length - violations.length;
    return {
        version: TCAUSAL_VERSION,
        scope,
        total,
        hit,
        rate: total ? hit / total : 1,
        violations: violations.length,
        violation_detail: violations.slice(0, 12),
        misses: misses.slice(0, 12),
        by_kind: byKind,
        measured: true,
    };
}

/** One call for a test or a diagnostics panel: authored cases first, then spine-generated ones. */
export function runTcausal(store, { authored = [], generated = 0, scope = 'canonical', injectedText = '', renderedBlock = '', available = null, limit = 40 } = {}) {
    const cases = [...(Array.isArray(authored) ? authored : []), ...(generated ? buildTcausalCases(store, { limit: generated }) : [])];
    return { ...scoreTcausal(store, cases, { scope, injectedText, renderedBlock, available }), authored: Array.isArray(authored) ? authored.length : 0, generated: cases.length - (Array.isArray(authored) ? authored.length : 0) };
}

export function formatTcausalReport(report) {
    if (!report || !report.measured) return 'T-Causal: 未测量（注入块不可读）';
    const lines = ['T-Causal ' + report.hit + '/' + report.total + ' (' + (report.rate === null ? 'n/a' : Number(report.rate).toFixed(3)) + ') 作用域=' + report.scope];
    for (const [kind, row] of Object.entries(report.by_kind || {})) {
        lines.push('  ' + kind + ': ' + row.hit + '/' + row.total + (row.violated ? ' 违规 ' + row.violated : '') + (row.missed ? ' 缺失 ' + row.missed : ''));
    }
    for (const miss of report.misses || []) lines.push('  MISS ' + miss.id + ' 缺: ' + (miss.missing || []).join(' | ').slice(0, 90));
    for (const bad of report.violation_detail || []) lines.push('  VIOLATION ' + bad.id + (bad.survived?.length ? ' 仍可答: ' + bad.survived.join(' | ').slice(0, 80) : '') + (bad.stale_live?.length ? ' 旧值仍作为现行: ' + bad.stale_live.join(',') : ''));
    return lines.join('\n');
}
