// Aetheria v5.5 — TauriTavern compatibility for the existing independent Embedding UI.
//
// TauriTavern's secret store intentionally does not expose plaintext keys by default. The normal
// Aetheria UI stores the key and immediately probes /api/vector, but native TauriTavern has no
// vector backend. This adapter intercepts only Aetheria's vector connect/test buttons in Tauri,
// stores the key through the host Secret API, keeps the plaintext only in this application session,
// and lets the private-vector wrapper route the probe into the plugin-owned vector backend.
import {
    configurePrivateVectorTransport,
    normalizeOpenAiEmbeddingBaseUrl,
} from './v55-private-vector-transport.js';
import {
    hasTauriVectorSessionSecret,
    isNativeTauriTavern,
    rememberTauriVectorSessionSecret,
} from './v55-tauri-vector-backend.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const VECTOR_TEST_PREFIX = 'aetheria_v55_tauri_probe_';
const VLLM_SECRET_KEY = 'api_key_vllm';
let installed = false;
let busy = false;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function settings(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || null;
}

function headers(ctx) {
    return typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
}

function value(id) {
    return String(document.getElementById(id)?.value || '').trim();
}

function setStatus(message, ok = null) {
    const el = document.getElementById('aum-v55-vector-direct-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = ok === true ? 'ok' : ok === false ? 'error' : 'idle';
}

async function saveVllmSecret(ctx, plaintext) {
    const response = await fetch('/api/secrets/write', {
        method: 'POST',
        headers: headers(ctx),
        body: JSON.stringify({
            key: VLLM_SECRET_KEY,
            value: plaintext,
            label: 'Aetheria Vector API',
        }),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`保存 Embedding API Key 失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 240)}` : ''}`);
    }
    const payload = await response.json().catch(() => ({}));
    const id = String(payload?.id || '').trim();
    if (!id) throw new Error('TauriTavern Secret Store 没有返回 secret id。');
    rememberTauriVectorSessionSecret(id, plaintext);
    return id;
}

async function vectorRequest(ctx, endpoint, body) {
    const response = await fetch(`/api/vector/${endpoint}`, {
        method: 'POST',
        headers: headers(ctx),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`Embedding 验证失败：HTTP ${response.status}${detail ? ` · ${detail.slice(0, 500)}` : ''}`);
    }
    if (response.status === 204) return null;
    return await response.json().catch(() => null);
}

async function probe(ctx, root) {
    const id = String(root.vector_direct_api_secret_id || '').trim();
    if (!id || !hasTauriVectorSessionSecret(id)) {
        throw new Error('当前 TauriTavern 会话没有可用的 Embedding 明文密钥。请重新输入 API Key 并点击“保存密钥并连接”。密钥不会写入插件向量库。');
    }
    const apiUrl = normalizeOpenAiEmbeddingBaseUrl(root.vector_direct_api_url);
    const model = String(root.vector_direct_api_model || '').trim();
    if (!apiUrl || !model) throw new Error('请填写 Embedding API 地址和模型。');
    const collectionId = `${VECTOR_TEST_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const text = 'Aetheria TauriTavern Jina embedding connectivity probe.';
    try {
        await vectorRequest(ctx, 'insert', {
            source: 'vllm', apiUrl, model, collectionId,
            items: [{ hash: 904211, text, index: 0 }],
        });
        const result = await vectorRequest(ctx, 'query', {
            source: 'vllm', apiUrl, model, collectionId,
            searchText: text, topK: 1, threshold: 0,
        });
        if (!Array.isArray(result?.metadata) || !result.metadata.length) {
            throw new Error('Embedding 请求已完成，但插件自有向量集合没有召回测试条目。');
        }
        return true;
    } finally {
        await vectorRequest(ctx, 'purge', { collectionId }).catch(() => {});
    }
}

async function connect() {
    const ctx = getContext();
    const root = settings(ctx);
    if (!ctx || !root) throw new Error('TauriTavern / SillyTavern context 不可用。');

    const enteredKey = value('aum-v55-vector-direct-key');
    const apiUrl = normalizeOpenAiEmbeddingBaseUrl(value('aum-v55-vector-direct-url') || root.vector_direct_api_url);
    const model = value('aum-v55-vector-direct-model') || String(root.vector_direct_api_model || '').trim();
    if (!apiUrl) throw new Error('请填写 Embedding API 地址。');
    if (!model) throw new Error('请填写 Embedding 模型名，例如 jina-embeddings-v3。');

    let secretId = String(root.vector_direct_api_secret_id || '').trim();
    if (enteredKey) {
        setStatus('正在把 API Key 保存到 TauriTavern Secret Store…');
        secretId = await saveVllmSecret(ctx, enteredKey);
        const keyInput = document.getElementById('aum-v55-vector-direct-key');
        if (keyInput) keyInput.value = '';
    }
    if (!secretId) throw new Error('请填写 API Key。');
    if (!hasTauriVectorSessionSecret(secretId)) {
        throw new Error('这个 API Key 只存在于 TauriTavern Secret Store，当前安全设置不允许扩展读回明文。请重新输入一次 API Key；Aetheria 只在当前应用会话内保留它用于 Jina Embedding 请求。');
    }

    root.vector_direct_api_secret_id = secretId;
    root.vector_direct_api_enabled = true;
    root.vector_direct_api_url = apiUrl;
    root.vector_direct_api_model = model;
    root.vector_source_mode = 'transformers';
    ctx.saveSettingsDebounced?.();
    configurePrivateVectorTransport(ctx);

    setStatus('已绕过 TauriTavern 未实现的 /api/vector 后端，正在直接测试 Embedding + 插件本地向量检索…');
    await probe(ctx, root);
    setStatus(`Embedding 连接成功：${model} ｜ TauriTavern 使用 Aetheria 自有向量后端`, true);
}

async function testOnly() {
    const ctx = getContext();
    const root = settings(ctx);
    if (!ctx || !root) throw new Error('Context 不可用。');
    setStatus('正在测试 Embedding + Aetheria Tauri 向量后端…');
    await probe(ctx, root);
    setStatus(`Embedding 测试成功：${root.vector_direct_api_model} ｜ 未调用 TauriTavern /api/vector 后端`, true);
}

async function handleClick(event) {
    if (!isNativeTauriTavern() || busy) return;
    const target = event.target?.closest?.('#aum-v55-vector-direct-connect, #aum-v55-vector-direct-test');
    if (!target) return;

    // Capture-phase interception prevents the upstream SillyTavern-oriented handler from issuing
    // a duplicate connection/probe after this Tauri-specific path completes.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    busy = true;
    try {
        if (target.id === 'aum-v55-vector-direct-connect') await connect();
        else await testOnly();
    } catch (error) {
        const message = String(error?.message || error);
        setStatus(message, false);
        globalThis.toastr?.error?.(message, 'Aetheria Embedding');
        console.error('[Aetheria v5.5 Tauri API Compat]', error);
    } finally {
        busy = false;
    }
}

export function installV55TauriApiCompat() {
    if (installed || typeof document === 'undefined' || !isNativeTauriTavern()) return installed;
    document.addEventListener('click', handleClick, true);
    installed = true;
    return true;
}

export function getV55TauriApiCompatStatus() {
    return { installed, active: installed && isNativeTauriTavern(), busy };
}
