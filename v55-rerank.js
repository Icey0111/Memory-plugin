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
 * `maxDrop` is the only bound on what the cross-encoder may do, and it is one-sided on purpose. Measured on
 * 22 live captures (2026-09-16), the stage replaced essentially the whole shortlist - `moved` 13 of 14 up to
 * 24 of 24 positions, and the fused first candidate lost the head in **every single one** - while the
 * answer-level A/B over the same fixture came out even, two recoveries against two. So a provider is trusted
 * to *promote* what the fusion ranked low (that is the case the stage exists for) and not to bury what the
 * fusion ranked high. A candidate may fall at most `maxDrop` places below its fused position; rising is
 * unbounded. `maxDrop >= pick.length - 1` reproduces the unbounded order exactly, which is what the offline
 * experiments that measured this stage's effect want.
 *
 * The default is unbounded, which is the stage as it was shipped. `maxDrop = 4` was implemented and measured
 * live on 2026-09-16 and **is not the default**: it holds exactly (`max_drop: 4` in all 40 captures, never more)
 * and it does not stop the fused first candidate losing the head, while it does hand the opening-instruction row
 * back into the evidence slots - `raw_2` was quoted in three of four probes in one run, against one of 44 probes
 * with the unbounded stage. Answer-level readings could not separate the arms (3 recoveries in ten probes for
 * the bounded stage, 2 in thirteen for each of the other two). The parameter stays so the complementary bound -
 * limit how far a candidate may *rise*, which keeps both properties - can be measured without re-plumbing this.
 *
 * The default lives in this signature rather than in a module constant because `runtime-precheck` fingerprints
 * function source: a bound written next to the code it governs cannot be changed on disk while the loaded page
 * keeps the old one undetected.
 */
export function rerankHead(pick, order, maxDrop = Infinity) {
    const scores = new Map(order.map(row => [row.index, row.score]));
    const ranked = pick.map((row, index) => ({ row, from: index, rerank: scores.get(index) ?? null }))
        .sort((a, b) => (b.rerank ?? -Infinity) - (a.rerank ?? -Infinity) || a.row.chunk.index - b.row.chunk.index);
    const bound = Number.isFinite(maxDrop) ? Math.max(0, Math.trunc(maxDrop)) : Infinity;
    const remaining = ranked.slice();
    const head = [];
    for (let position = 0; position < pick.length; position += 1) {
        // Whoever the bound runs out on at this position has to go now, whichever way it was scored. Every
        // fused position has a distinct deadline, so at most one candidate is ever forced and the loop cannot
        // starve: the fused order is the fallback whenever nothing needs forcing.
        const forced = remaining.findIndex(entry => entry.from + bound === position);
        head.push(remaining.splice(forced >= 0 ? forced : 0, 1)[0].row);
    }
    return head;
}

export function applyRerankOrder(ranked, pick, order, maxDrop) {
    return [...rerankHead(pick, order, maxDrop), ...ranked.filter(row => !pick.includes(row))];
}

/**
 * What the stage changed, so a run can answer "did the reranking do anything" from its own record.
 *
 * Ten live runs recorded `rerank_used` and `rerank_cost` and nothing about the order, so none of them could
 * say whether the prompt moved: a configured reranker read the same whether it reordered the shortlist or
 * returned the fused order back. `moved` counts the shortlist positions whose occupant changed, `top1_changed`
 * is the head, and the two three-entry source lists are the before and after a reader can check by eye.
 */
export function rerankMoveMetrics(pick, order, maxDrop) {
    const head = rerankHead(pick, order, maxDrop);
    const sources = rows => rows.slice(0, 3).map(row => String(row.chunk && row.chunk.source));
    // `moved` says how much of the order changed; `max_drop` says whether the bound held, which is the number
    // a bounded stage has to be judged by: a near-reversal can change every position and still keep the fused
    // head inside its bound.
    const to = new Map(head.map((row, index) => [row.chunk, index]));
    let moved = 0;
    let worstDrop = 0;
    for (let index = 0; index < pick.length; index += 1) {
        if (head[index].chunk !== pick[index].chunk) moved += 1;
        const landed = to.has(pick[index].chunk) ? to.get(pick[index].chunk) : index;
        if (landed > index) worstDrop = Math.max(worstDrop, landed - index);
    }
    return { shortlist: pick.length, moved, max_drop: worstDrop,
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
    let response = await post(base + '/rerank', body);
    let transport = 'compatible';
    // 404 is "no such endpoint", the one status that says the request was addressed to the wrong path. A
    // 401/429/5xx is a refusal at the right one, so those are reported rather than retried somewhere else.
    if (response.status === 404) {
        const url = nativeRerankUrl(base);
        if (url) {
            const retry = await post(url, buildNativeRerankRequest({ model, query, documents, topN }));
            if (retry.ok) { response = retry; transport = 'native'; }
            else if (retry.status !== 404) { response = retry; }
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
