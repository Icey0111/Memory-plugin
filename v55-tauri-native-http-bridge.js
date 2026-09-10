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
//
// Only generate_chat_completion is used. The sibling get_chat_completions_status command is
// deliberately NOT used for embedding model discovery: TauriTavern maps any failure of that
// command through log_user_visible_error (presentation/commands/helpers.rs), which pushes a
// global "后端错误" toast to the user through the native backend-error bridge. That toast is
// emitted by the Rust side, so an extension cannot suppress it by catching the rejection.

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

// The host applies its own, deliberately generous budget to every ChatCompletion call
// (tt-adapter-http/src/pool.rs: 3 min connect, 10 min request). That budget is sized for a human
// watching a chat stream, not for background vector work that runs inside a turn pipeline, so a
// provider this device cannot reach would stall the plugin for minutes on every call. Bound our own
// wait well inside it, growing a little with batch size so a healthy but slow provider is not cut off.
const NATIVE_REQUEST_BUDGET_MIN_MS = 250;
const NATIVE_REQUEST_BUDGET_BASE_MS = 60_000;
const NATIVE_REQUEST_BUDGET_PER_ITEM_MS = 500;
const NATIVE_REQUEST_BUDGET_MAX_MS = 150_000;
const NATIVE_TIMEOUT_MARK = 'AETHERIA_NATIVE_REQUEST_BUDGET_EXCEEDED';

export function resolveNativeRequestBudgetMs(body, overrideMs = null) {
    const requested = Number(overrideMs);
    if (Number.isFinite(requested) && requested > 0) {
        return Math.min(NATIVE_REQUEST_BUDGET_MAX_MS, Math.max(NATIVE_REQUEST_BUDGET_MIN_MS, Math.round(requested)));
    }
    const items = Array.isArray(body?.input) ? body.input.length : 1;
    const extra = Math.max(0, items - 1) * NATIVE_REQUEST_BUDGET_PER_ITEM_MS;
    return Math.min(NATIVE_REQUEST_BUDGET_MAX_MS, NATIVE_REQUEST_BUDGET_BASE_MS + extra);
}

export async function requestEmbeddingJsonViaTauriNative({ endpoint, apiKey, body, timeoutMs = null }) {
    const host = getHost();
    if (!host) throw new Error('TauriTavern Host ABI 不可用。');
    try { await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve()); } catch {}
    const safeInvoke = getTauriSafeInvoke();
    if (!safeInvoke) throw new Error('TauriTavern native invoke broker 不可用。');
    const request = buildTauriEmbeddingInvoke({ endpoint, apiKey, body });
    const budgetMs = resolveNativeRequestBudgetMs(body, timeoutMs);
    let timer = null;
    try {
        // Promise.race attaches handlers to both sides, so abandoning the native call on timeout does
        // not leave an unhandled rejection behind. The host-side request itself is not cancellable
        // from here, which is exactly why the call has to be abandoned rather than awaited.
        const result = await Promise.race([
            safeInvoke(request.command, request.args),
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => {
                    const error = new Error(`等待宿主原生 HTTP 响应超过 ${Math.round(budgetMs / 1000)} 秒（宿主自身连接预算为 3 分钟）。`);
                    error.code = NATIVE_TIMEOUT_MARK;
                    reject(error);
                }, budgetMs);
            }),
        ]);
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('native provider 返回的 JSON 不是对象。');
        return result;
    } catch (error) {
        const message = String(error?.message || error || 'unknown native transport error');
        const timedOut = error?.code === NATIVE_TIMEOUT_MARK || /timed out|timeout|time-out/i.test(message);
        throw new Error(`TauriTavern Native HTTP Embedding 请求失败：${message}${timedOut ? NATIVE_TIMEOUT_HINT : ''}`);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// Requests leaving through the host native stack inherit the host's own connect/read budget and
// proxy configuration (or its absence). A timeout here is a reachability problem between this
// device and the provider, not a plugin misconfiguration, so say so explicitly instead of leaving
// the raw host text to be misread as a bug in the Aetheria transport. TauriTavern builds every
// provider client with .no_proxy(), so the OS/system proxy is never used — only the host's own
// request-proxy setting is.
const NATIVE_TIMEOUT_HINT = '（宿主原生 HTTP 请求超时：请确认本机/移动网络能直连该供应商。注意 TauriTavern 不会使用系统代理，只会使用它自己的「请求代理」设置；必要时在宿主里配置代理，或把接口地址换成可直连的镜像地址后重试。）';

// NOTE: there is intentionally no discoverModelsViaTauriNative()/buildTauriModelDiscoveryInvoke()
// here. Enumerating embedding models is optional decoration, and the only host ABI that could do it
// (get_chat_completions_status) turns every miss into an unsuppressable user-visible backend error
// toast. See the header comment.
