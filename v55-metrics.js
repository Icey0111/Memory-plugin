// Aetheria Unified Memory v5.5 — end-to-end cost metering.
//
// Optimising only the injected context moves cost into the background. These counters make the
// whole pipeline observable: quiet model calls (extraction/summary), embedding calls, and an
// estimated prompt/completion token volume. The estimate is a least-squares fit of the provider's
// own prompt_tokens over 126 retained requests (see v55-tokenizer.js); it exists to expose trends and
// to drive budgeting, not to replace provider billing.

import { estimateTokens as estimateTokensForText, TOKEN_MODEL, tokenModelLabel } from './v55-tokenizer.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const KINDS = ['extraction', 'summary', 'other'];

export function emptyMetrics() {
    return {
        version: 1,
        model_calls: { extraction: 0, summary: 0, other: 0 },
        model_calls_total: 0,
        embed_calls: 0,
        embed_items: 0,
        prompt_chars: 0,
        completion_chars: 0,
        embed_chars: 0,
        est_prompt_tokens: 0,
        est_completion_tokens: 0,
        est_embed_tokens: 0,
        last_at: null,
    };
}

function settingsRoot(ctx) {
    const settings = ctx?.extensionSettings?.[SETTINGS_KEY];
    return settings && typeof settings === 'object' ? settings : null;
}

export function getMetrics(ctx) {
    const settings = settingsRoot(ctx);
    if (!settings) return emptyMetrics();
    if (!settings.metrics || typeof settings.metrics !== 'object' || Array.isArray(settings.metrics)) {
        settings.metrics = emptyMetrics();
    }
    const m = settings.metrics;
    const base = emptyMetrics();
    for (const key of Object.keys(base)) if (m[key] === undefined) m[key] = base[key];
    if (!m.model_calls || typeof m.model_calls !== 'object' || Array.isArray(m.model_calls)) m.model_calls = base.model_calls;
    for (const kind of KINDS) if (!Number.isFinite(Number(m.model_calls[kind]))) m.model_calls[kind] = 0;
    for (const key of ['model_calls_total', 'embed_calls', 'embed_items', 'prompt_chars', 'completion_chars', 'embed_chars', 'est_prompt_tokens', 'est_completion_tokens', 'est_embed_tokens']) {
        if (!Number.isFinite(Number(m[key]))) m[key] = 0;
    }
    return m;
}

/**
 * Accepts the text itself (preferred — the script mix drives the estimate) or a bare character count
 * (falls back to the measured whole-request average of ~2.2 characters per token). The former
 * chars / 4 under-reported a Chinese prompt by about 46%.
 */
export function estimateTokens(value) {
    if (typeof value === 'string') return estimateTokensForText(value);
    const chars = Math.max(0, Number(value) || 0);
    return chars ? Math.max(1, Math.ceil(chars / TOKEN_MODEL.fallbackCharsPerToken)) : 0;
}

export function recordModelCall(ctx, { kind = 'other', promptChars = 0, completionChars = 0, promptText = null, completionText = null, save = true } = {}) {
    const m = getMetrics(ctx);
    const bucket = KINDS.includes(kind) ? kind : 'other';
    m.model_calls[bucket] += 1;
    m.model_calls_total += 1;
    m.prompt_chars += Math.max(0, Number(promptChars) || 0);
    m.completion_chars += Math.max(0, Number(completionChars) || 0);
    m.est_prompt_tokens += estimateTokens(promptText ?? promptChars);
    m.est_completion_tokens += estimateTokens(completionText ?? completionChars);
    m.last_at = Date.now();
    if (save) ctx?.saveSettingsDebounced?.();
    return m;
}

export function recordEmbeddingCall(ctx, { count = 0, chars = 0, save = true } = {}) {
    const m = getMetrics(ctx);
    m.embed_calls += 1;
    m.embed_items += Math.max(0, Math.floor(Number(count) || 0));
    m.embed_chars += Math.max(0, Number(chars) || 0);
    m.est_embed_tokens += estimateTokens(chars);
    m.last_at = Date.now();
    if (save) ctx?.saveSettingsDebounced?.();
    return m;
}

export function resetMetrics(ctx) {
    const settings = settingsRoot(ctx);
    if (!settings) return emptyMetrics();
    settings.metrics = emptyMetrics();
    ctx?.saveSettingsDebounced?.();
    return settings.metrics;
}

export function formatMetrics(ctx) {
    const m = getMetrics(ctx);
    return [
        `后台模型调用：抽取 ${m.model_calls.extraction} ｜ 总结 ${m.model_calls.summary} ｜ 其他 ${m.model_calls.other} ｜ 合计 ${m.model_calls_total}`,
        `估算 token：prompt ≈ ${m.est_prompt_tokens} ｜ completion ≈ ${m.est_completion_tokens} ｜ embedding ≈ ${m.est_embed_tokens}`,
        `Embedding 调用：${m.embed_calls} 次 / ${m.embed_items} 项`,
        `字符量：prompt ${m.prompt_chars} ｜ completion ${m.completion_chars} ｜ embed ${m.embed_chars}`,
        `token 模型：${tokenModelLabel()}`,
    ].join('\n');
}