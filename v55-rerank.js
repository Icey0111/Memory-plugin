// A cross-encoder rerank stage for the original-text candidates.
//
// Measured offline on 52 hand-written questions (ADR-0016): reranking
// the top 24 fused candidates with jina-reranker-v3 raised answer-in-context from 69% to 87%, ten questions
// gained against one lost, p=0.012; jina-reranker-v2-base-multilingual reached 81%. It is the most expensive
// layer - one call per generation over the whole shortlist - so it runs only when a model is configured, it
// is fail-open, and it never reorders a candidate the provider did not actually score.

import { resolveOpenAiCompatibleBaseUrl } from './v55-tauri-vector-backend.js';
import { estimateTokens } from './v55-tokenizer.js';
import { hasTauriNativeHttpBridge, tauriNativeFetch } from './v55-tauri-native-http-bridge.js';

export const RERANK_CANDIDATES = 24;

export function rerankShortlist(ranked, visibleSources, limit = 24, extra = 8) {
    const eligible = ranked.filter(row => !visibleSources.has(row.chunk.source));
    const head = eligible.slice(0, limit);
    return [...head, ...eligible.filter(row => !head.includes(row)
        && row.channels.some(channel => channel === 'entity' || channel === 'profile')).slice(0, extra)];
}

/**
 * The reordered shortlist, before it is put back in front of the tail it did not touch.
 *
 * Two one-sided bounds decide how far the cross-encoder may move a candidate from where the fusion put it.
 * Measured on 22 live captures (2026-09-16), the stage replaced essentially the whole shortlist - `moved` 13 of
 * 14 up to 24 of 24 positions, and the fused first candidate lost the head in **every single one** - while the
 * answer-level A/B over the same fixture came out even, two recoveries against two.
 *
 *   `maxDrop`  how many places below its fused position a candidate may land.
 *   `maxRise`  how many places above it a candidate may land.
 *
 * Bounding the drop is the wrong lever and was measured as such: it holds exactly (`max_drop: 4` in all 39
 * captures of three runs, never more) but it does not stop the fused first candidate losing the head, and it
 * hands the opening-instruction row back into the evidence slots - `raw_2` was quoted in three of four probes in
 * one run, against one of 44 probes across the thirteen unbounded runs. Clearing that row out of the head needs
 * a *large* demotion, so demotion has to stay unbounded. `maxRise = 0` is the fused order exactly and either
 * bound at `pick.length - 1` or more stops bounding that direction, so `(Infinity, Infinity)` is the stage
 * as it was first shipped and is what the offline experiments in dev_docs were measured with.
 *
 * **The rise bound was shipped at four and then removed, on measurement (2026-09-16).** Its stated benefit was
 * the opening instruction row: it is quoted in 7% of probes on `path2-shiyuan` and 24-36% on the dense fixture
 * when the rise is bounded, against 0% and 18% unbounded - the direction is the opposite of the claim, and it now
 * has a mechanism. With the rise bounded
 * the head is filled from the fusion's own leaders, and the fusion's leader is often the user's own instruction,
 * which is lexically close to the query; the cross-encoder, which reads the text, prefers the story rows.
 * Its cost is structural: the block holds five entries, so a candidate the fusion placed at position
 * `maxRise + 5` or later cannot enter it whatever the provider scores it. Replaying recorded builds at both
 * bounds (three dense runs, 16 of 16 replays reproducing the recorded order) attributed 6 of 16 failed probes to
 * the bound, and in two of five the document the provider scored **highest** was the one held out. Retrieval over
 * the dense fixture recovered 15 of 42 probed details bounded against 10 of 12 at twelve and 15 of 21 unbounded.
 *
 * The defaults live in this signature rather than in a module constant because `runtime-precheck` fingerprints
 * function source: a bound written next to the code it governs cannot be changed on disk while the loaded page
 * keeps the old one undetected.
 */
export function rerankHead(pick, order, maxDrop = Infinity, maxRise = Infinity) {
    const scores = new Map(order.map(row => [row.index, row.score]));
    const ranked = pick.map((row, index) => ({ row, from: index, rerank: scores.get(index) ?? null }))
        .sort((a, b) => (b.rerank ?? -Infinity) - (a.rerank ?? -Infinity) || a.row.chunk.index - b.row.chunk.index);
    const drop = Number.isFinite(maxDrop) ? Math.max(0, Math.trunc(maxDrop)) : Infinity;
    const rise = Number.isFinite(maxRise) ? Math.max(0, Math.trunc(maxRise)) : Infinity;
    const remaining = ranked.slice();
    const head = [];
    for (let position = 0; position < pick.length; position += 1) {
        // A candidate whose deadline is this position has to go now, whichever way it was scored; every fused
        // position has a distinct deadline, so at most one is ever forced. Otherwise the best-scoring candidate
        // that is already released is taken, and that set is never empty: the smallest unplaced fused position
        // is at most this one, and nothing is ever placed before its release.
        const forced = remaining.findIndex(entry => entry.from + drop === position);
        const take = forced >= 0 ? forced : remaining.findIndex(entry => entry.from - rise <= position);
        head.push(remaining.splice(take, 1)[0].row);
    }
    return head;
}

export function applyRerankOrder(ranked, pick, order, maxDrop, maxRise) {
    return [...rerankHead(pick, order, maxDrop, maxRise), ...ranked.filter(row => !pick.includes(row))];
}

/**
 * Where the stage found each candidate, and what it scored it.
 *
 * `fused` is the candidate's position in the order the fusion produced, and `rerank` is the provider's score,
 * null for a candidate the shortlist did not send. `rerankHead` is a pure function of exactly those two numbers
 * and a bound, so a build that records them can be replayed at any bound offline - which is the only way to
 * tell "the reranker ranked it thirtieth" from "the reranker ranked it second and the rise bound held it at
 * `from - maxRise`". Without them the two are indistinguishable in every recorded run, because
 * `evidence_candidates` is the order the packer was given, after the reorder. Measured need: of 34 probes
 * whose detail was not conveyed, 17 had their only carrier row ranked and outside the five-entry block, and the
 * record could not say which of the two put it there.
 */
export function rerankOrigin(ranked, pick, order) {
    const fused = new Map(ranked.map((row, index) => [row.chunk, index]));
    const rerank = new Map();
    if (Array.isArray(order)) {
        for (const row of order) {
            const picked = pick[Number(row && row.index)];
            if (picked) rerank.set(picked.chunk, Number(row.score));
        }
    }
    return { fused, rerank };
}

/**
 * What the stage changed, so a run can answer "did the reranking do anything" from its own record.
 *
 * Ten live runs recorded `rerank_used` and `rerank_cost` and nothing about the order, so none of them could
 * say whether the prompt moved: a configured reranker read the same whether it reordered the shortlist or
 * returned the fused order back. `moved` counts the shortlist positions whose occupant changed, `top1_changed`
 * is the head, and the two three-entry source lists are the before and after a reader can check by eye.
 */
export function rerankMoveMetrics(pick, order, maxDrop, maxRise) {
    const head = rerankHead(pick, order, maxDrop, maxRise);
    const sources = rows => rows.slice(0, 3).map(row => String(row.chunk && row.chunk.source));
    // `moved` says how much of the order changed; `max_drop` says whether the bound held, which is the number
    // a bounded stage has to be judged by: a near-reversal can change every position and still keep the fused
    // head inside its bound.
    const to = new Map(head.map((row, index) => [row.chunk, index]));
    let moved = 0;
    let worstDrop = 0;
    let worstRise = 0;
    for (let index = 0; index < pick.length; index += 1) {
        if (head[index].chunk !== pick[index].chunk) moved += 1;
        const landed = to.has(pick[index].chunk) ? to.get(pick[index].chunk) : index;
        if (landed > index) worstDrop = Math.max(worstDrop, landed - index);
        if (landed < index) worstRise = Math.max(worstRise, index - landed);
    }
    return { shortlist: pick.length, moved, max_drop: worstDrop, max_rise: worstRise,
        top1_changed: pick.length > 0 && head[0].chunk !== pick[0].chunk,
        top_before: sources(pick), top_after: sources(head) };
}

/** The request a cross-encoder reranker expects. */
export function buildRerankRequest({ model, query, documents, topN }) {
    const text = value => String(value ?? '');
    const body = { model: text(model).trim(), query: text(query), documents: Array.from(documents || [], text) };
    if (!body.model) throw new Error('重排模型未配置。');
    if (!body.query) throw new Error('重排查询为空。');
    if (!body.documents.length || body.documents.some(document => !document)) throw new Error('重排候选为空。');
    body.top_n = Math.max(1, Math.min(body.documents.length, Math.trunc(Number(topN) || body.documents.length)));
    return body;
}

/**
 * The order a reranker returned, checked against the documents that were sent.
 *
 * An index the provider was never given, a non-finite score, or two rows for one document would reorder
 * the prompt around nothing, so those rows are dropped rather than trusted. An answer that names no usable
 * candidate is an error, not an empty order: the caller keeps the fused ranking instead.
 */
export function parseRerankResponse(payload, count) {
    const rows = Array.isArray(payload?.results) ? payload.results : null;
    if (!rows) throw new Error('重排返回格式无效：缺少 results 数组。');
    const seen = new Set();
    const order = [];
    for (const row of rows) {
        const index = Number(row?.index);
        const score = Number(row?.relevance_score);
        if (!Number.isInteger(index) || index < 0 || index >= count || seen.has(index)) continue;
        if (!Number.isFinite(score)) continue;
        seen.add(index);
        order.push({ index, score });
    }
    if (!order.length) throw new Error('重排未返回任何可用候选。');
    return order.sort((a, b) => b.score - a.score || a.index - b.index);
}

/**
 * The path a provider may serve a rerank on when it does not serve the OpenAI-compatible one.
 *
 * A provider can list a rerank model in `/models` and still answer `{base}/rerank` with 404. Aliyun's MaaS does
 * exactly that: the same key and the same model (`qwen3.7-text-rerank`) answered
 * `{origin}/api/v1/services/rerank/text-rerank/text-rerank` with 200 while the compatible path returned 404.
 * Without this fallback the stage fails open, records `rerank_used: false`, and the setting looks inert - which
 * is how it was read before this was measured.
 */
export const NATIVE_RERANK_PATH = '/api/v1/services/rerank/text-rerank/text-rerank';

/** Base URLs whose compatible path already answered 404, so the native path is tried first from then on. */
const NATIVE_PATH_BASES = new Set();

/**
 * The settings object, so a discovered native path can be remembered across page loads.
 *
 * Without this the probe happens once per session, and each one is a real 404 the host raises to the install's
 * UI - "Custom OpenAI endpoint failed with status 404" - for a call that was designed to fail. `bindRerankSettings`
 * seeds the memory from `narrative_rerank_native_paths`, and every later discovery is written back to it.
 */
let settingsRef = null;

/**
 * How the host is asked to write the settings object down.
 *
 * The host keeps extension settings in memory and persists them on its own debounce, so mutating the object
 * is not saving it. Measured on a live install: the plugin discovered the native path during the first
 * generation of a run, and the settings file still did not carry it fifteen minutes later - the write that
 * eventually landed came from somewhere else. For a memory whose entire purpose is to survive a page load,
 * that is a hole, so the discovery asks for the write itself.
 */
let saveRef = null;

export function bindRerankSettings(settings, save) {
    settingsRef = settings && typeof settings === 'object' ? settings : null;
    saveRef = typeof save === 'function' ? save : null;
    const known = settingsRef && Array.isArray(settingsRef.narrative_rerank_native_paths)
        ? settingsRef.narrative_rerank_native_paths : [];
    NATIVE_PATH_BASES.clear();
    for (const base of known) NATIVE_PATH_BASES.add(String(base));
    return NATIVE_PATH_BASES.size;
}

function rememberNativePath(base, remember) {
    // Nothing to write when the memory already says this, and a save that runs on every generation for
    // nothing is a different problem than the one this fixes.
    if (NATIVE_PATH_BASES.has(base) === Boolean(remember)) return;
    if (remember) NATIVE_PATH_BASES.add(base); else NATIVE_PATH_BASES.delete(base);
    if (settingsRef) settingsRef.narrative_rerank_native_paths = [...NATIVE_PATH_BASES];
    if (saveRef) saveRef();
}

/** That path hangs off the host the base URL names, not off the base URL's own path. */
export function nativeRerankUrl(baseUrl) {
    const base = resolveOpenAiCompatibleBaseUrl(baseUrl);
    if (!base) return null;
    try { return new URL(NATIVE_RERANK_PATH, new URL(base).origin).toString(); } catch (error) { return null; }
}

/** The same request in the shape that path expects: `input`/`parameters` rather than a flat body. */
export function buildNativeRerankRequest({ model, query, documents, topN }) {
    const body = buildRerankRequest({ model, query, documents, topN });
    return { model: body.model, input: { query: body.query, documents: body.documents },
        parameters: { top_n: body.top_n } };
}

/** Its response, validated by the same rules: `output.results` rather than `results`. */
export function parseNativeRerankResponse(payload, count) {
    const results = payload && payload.output ? payload.output.results : null;
    if (!Array.isArray(results)) throw new Error('重排返回格式无效：缺少 output.results 数组。');
    return parseRerankResponse({ results }, count);
}

export async function requestRerank({ baseUrl, apiKey, model, query, documents, topN, fetchImpl }) {
    const base = resolveOpenAiCompatibleBaseUrl(baseUrl);
    if (!base) throw new Error('重排地址未配置。');
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('重排 API Key 未配置。');
    const body = buildRerankRequest({ model, query, documents, topN });
    // The WebView's fetch is blocked by CORS for provider traffic - the embedding path left it behind for the
    // host's native HTTP shim for exactly that reason - so a rerank that keeps using it fails with "Failed to
    // fetch" without reaching any provider. Measured on the install this was written for: 34 ms, no call.
    const send = fetchImpl || (hasTauriNativeHttpBridge() ? tauriNativeFetch(key) : globalThis.fetch?.bind(globalThis));
    if (typeof send !== 'function') throw new Error('重排传输不可用。');
    const started = performance.now();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + key };
    const post = (url, payload) => send(url, { method: 'POST', signal: AbortSignal.timeout(60000),
        headers, body: JSON.stringify(payload) });
    // A provider that serves rerank only on its own path answers the compatible one with 404 **every time**,
    // and here that 404 is not private: the native shim is the host's own `generate_chat_completion`, so the
    // host raised "Custom OpenAI endpoint failed with status 404" on every generation while the retry quietly
    // answered. That is the toast a live install sees while the story keeps being written. Once a base URL has
    // answered on the native path, go straight there; the probe is remembered per base, not globally.
    const nativeUrl = nativeRerankUrl(base);
    const nativeFirst = Boolean(nativeUrl) && NATIVE_PATH_BASES.has(base);
    let response = nativeFirst
        ? await post(nativeUrl, buildNativeRerankRequest({ model, query, documents, topN }))
        : await post(base + '/rerank', body);
    let transport = nativeFirst ? 'native' : 'compatible';
    // 404 is "no such endpoint", the one status that says the request was addressed to the wrong path. A
    // 401/429/5xx is a refusal at the right one, so those are reported rather than retried somewhere else.
    if (response.status === 404) {
        if (nativeUrl && transport === 'compatible') {
            const retry = await post(nativeUrl, buildNativeRerankRequest({ model, query, documents, topN }));
            if (retry.ok) { response = retry; transport = 'native'; rememberNativePath(base, true); }
            else if (retry.status !== 404) { response = retry; }
        } else {
            // The remembered path refused too, so the memory is wrong rather than the provider: probe again.
            rememberNativePath(base, false);
        }
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error('重排请求失败：HTTP ' + response.status + (detail ? ' · ' + detail.slice(0, 300) : ''));
    }
    const payload = await response.json().catch(() => null);
    const order = transport === 'native' ? parseNativeRerankResponse(payload, body.documents.length)
        : parseRerankResponse(payload, body.documents.length);
    Object.defineProperty(order, 'metrics', { value: { elapsed_ms: Math.round(performance.now() - started),
        documents: body.documents.length, transport,
        input_tokens_estimated: estimateTokens([query, ...body.documents].join('\n')),
        provider_tokens: payload?.usage?.total_tokens ?? null } });
    return order;
}
