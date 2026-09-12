// A cross-encoder rerank stage for the original-text candidates.
//
// Measured offline on 52 hand-written questions (dev_docs/06_retrieval_research.md section 14): reranking
// the top 24 fused candidates with jina-reranker-v3 raised answer-in-context from 69% to 87%, ten questions
// gained against one lost, p=0.012; jina-reranker-v2-base-multilingual reached 81%. It is the most expensive
// layer - one call per generation over the whole shortlist - so it runs only when a model is configured, it
// is fail-open, and it never reorders a candidate the provider did not actually score.

import { resolveOpenAiCompatibleBaseUrl } from './v55-tauri-vector-backend.js';

export const RERANK_CANDIDATES = 24;

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

export async function requestRerank({ baseUrl, apiKey, model, query, documents, topN, fetchImpl }) {
    const base = resolveOpenAiCompatibleBaseUrl(baseUrl);
    if (!base) throw new Error('重排地址未配置。');
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('重排 API Key 未配置。');
    const body = buildRerankRequest({ model, query, documents, topN });
    const send = fetchImpl || globalThis.fetch?.bind(globalThis);
    if (typeof send !== 'function') throw new Error('重排传输不可用。');
    const response = await send(base + '/rerank', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body) });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error('重排请求失败：HTTP ' + response.status + (detail ? ' · ' + detail.slice(0, 300) : ''));
    }
    return parseRerankResponse(await response.json().catch(() => null), body.documents.length);
}