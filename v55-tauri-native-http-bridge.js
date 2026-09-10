// Aetheria Unified Memory v5.5 — TauriTavern native HTTP bridge.
//
// TauriTavern WebView fetch() can be blocked by browser CORS even though the native Rust
// backend can reach the same provider. TauriTavern currently has no public generic HTTP POST
// extension ABI, but it does expose its native ChatCompletion command through the stable
// Host ABI invoke broker. The custom/reverse-proxy path is sufficiently generic to carry an
// OpenAI-compatible embedding request without touching the host Secret Store:
//
//   reverse_proxy = "https://provider/v1/embeddings?"
//   native code appends "/chat/completions"
//   resulting URL = "https://provider/v1/embeddings?/chat/completions"
//
// URL semantics keep the path at /v1/embeddings and put the appended suffix in the query.
// custom_include_body then replaces the chat payload with the embedding fields, while
// custom_exclude_body removes the temporary messages/prompt. proxy_password is request-local
// and becomes the Bearer token inside TauriTavern; no host secret is read, written, selected,
// or rotated.

const clean = (value, max = 20000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const getHost = () => globalThis.__TAURITAVERN__ || globalThis.window?.__TAURITAVERN__ || null;

function requestId() {
    const raw = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `aumemb-${String(raw).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90)}`;
}

export function getTauriSafeInvoke() {
    const host = getHost();
    const fn = host?.invoke?.safeInvoke;
    return typeof fn === 'function' ? fn.bind(host.invoke) : null;
}

export function hasTauriNativeHttpBridge() {
    return Boolean(getHost() && getTauriSafeInvoke());
}

export function buildTauriEmbeddingInvoke({ endpoint, apiKey, body }) {
    const url = clean(endpoint, 4000).replace(/\/+$/, '');
    const key = clean(apiKey, 20000);
    const payload = body && typeof body === 'object' && !Array.isArray(body) ? structuredClone(body) : null;
    if (!url || !/^https?:\/\//i.test(url)) throw new Error('Embedding endpoint 无效。');
    if (!key) throw new Error('Embedding API Key 为空。');
    if (!payload?.model || !Array.isArray(payload?.input) || payload.input.length === 0) throw new Error('Embedding 请求体无效。');

    // The trailing '?' is intentional. TauriTavern's Rust adapter concatenates the provider
    // endpoint suffix literally; everything appended after '?' becomes query text, so the actual
    // HTTP path remains exactly the embedding endpoint.
    const reverseProxy = `${url}?`;
    return {
        command: 'generate_chat_completion',
        args: {
            requestId: requestId(),
            dto: {
                chat_completion_source: 'custom',
                custom_api_format: 'openai_compat',
                reverse_proxy: reverseProxy,
                proxy_password: key,
                model: clean(payload.model, 1000),
                messages: [{ role: 'user', content: 'Aetheria native embedding transport shim.' }],
                custom_include_body: payload,
                custom_exclude_body: ['messages', 'prompt'],
                custom_include_headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            },
        },
        effectiveUrl: `${url}?/chat/completions`,
        effectivePath: (() => {
            try { return new URL(`${url}?/chat/completions`).pathname; } catch { return ''; }
        })(),
    };
}

export async function requestEmbeddingJsonViaTauriNative({ endpoint, apiKey, body }) {
    const host = getHost();
    if (!host) throw new Error('TauriTavern Host ABI 不可用。');
    try { await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve()); } catch {}
    const safeInvoke = getTauriSafeInvoke();
    if (!safeInvoke) throw new Error('TauriTavern native invoke broker 不可用。');
    const request = buildTauriEmbeddingInvoke({ endpoint, apiKey, body });
    try {
        const result = await safeInvoke(request.command, request.args);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('native provider 返回的 JSON 不是对象。');
        return result;
    } catch (error) {
        const message = String(error?.message || error || 'unknown native transport error');
        throw new Error(`TauriTavern Native HTTP Embedding 请求失败：${message}`);
    }
}

export function buildTauriModelDiscoveryInvoke({ baseUrl, apiKey }) {
    const base = clean(baseUrl, 4000).replace(/\/+$/, '');
    const key = clean(apiKey, 20000);
    if (!base || !/^https?:\/\//i.test(base)) throw new Error('Embedding API base URL 无效。');
    if (!key) throw new Error('Embedding API Key 为空。');
    return {
        command: 'get_chat_completions_status',
        args: {
            dto: {
                chat_completion_source: 'custom',
                reverse_proxy: base,
                proxy_password: key,
                custom_url: '',
                custom_include_headers: { Accept: 'application/json' },
                bypass_status_check: false,
            },
        },
    };
}

export async function discoverModelsViaTauriNative({ baseUrl, apiKey }) {
    const host = getHost();
    if (!host) return [];
    try { await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve()); } catch {}
    const safeInvoke = getTauriSafeInvoke();
    if (!safeInvoke) return [];
    const request = buildTauriModelDiscoveryInvoke({ baseUrl, apiKey });
    try {
        const result = await safeInvoke(request.command, request.args);
        const rows = [result?.data, result?.models, result?.model_list, result].find(Array.isArray) || [];
        return [...new Set(rows.map(row => typeof row === 'string' ? row : (row?.id || row?.model || row?.name || row?.slug || '')).map(String).map(value => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    } catch {
        return [];
    }
}
