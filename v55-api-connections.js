// Aetheria Unified Memory v5.5 — independent API connection settings.
// Summary and embedding connections deliberately use different discovery/probe paths.
import {
    configurePrivateVectorTransport,
    getPrivateVectorTransportStatus,
    invalidateAetheriaVectorState,
    normalizeOpenAiEmbeddingBaseUrl,
} from './v55-private-vector-transport.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const SUMMARY_PROFILE_NAME = 'Aetheria · Summary API';
const VECTOR_TEST_PREFIX = 'aetheria_v55_vector_probe_';
const DEFAULTS = Object.freeze({
    summary_direct_api_enabled: false,
    summary_direct_api_mode: 'openai_compatible',
    summary_direct_api_url: '',
    summary_direct_api_model: '',
    summary_direct_api_secret_id: '',
    summary_direct_api_profile_id: '',
    summary_direct_api_models: [],
    vector_direct_api_enabled: false,
    vector_direct_api_mode: 'openai_compatible',
    vector_direct_api_url: '',
    vector_direct_api_model: '',
    vector_direct_api_secret_id: '',
    vector_direct_api_probe_secret_id: '',
    vector_direct_api_models: [],
});

let secretsModulePromise = null;
let mounted = false;

function getContext() { return globalThis.SillyTavern?.getContext?.(); }
function ensureSettings(ctx) {
    if (!ctx?.extensionSettings) return null;
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') ctx.extensionSettings[SETTINGS_KEY] = {};
    const settings = ctx.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULTS)) if (settings[key] === undefined) settings[key] = Array.isArray(value) ? [...value] : value;
    return settings;
}
function normalizeUrl(value) { return String(value || '').trim().replace(/\/+$/, ''); }
function uuid() { return globalThis.crypto?.randomUUID?.() || `aum-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function notify(type, message) { const toast = globalThis.toastr; if (toast && typeof toast[type] === 'function') toast[type](message, 'Aetheria API'); }
async function getSecretsModule() { if (!secretsModulePromise) secretsModulePromise = import('/scripts/secrets.js').catch(() => null); return secretsModulePromise; }
async function saveSecret(secretKeyName, value, label) {
    const key = String(value || '').trim();
    if (!key) return null;
    const secrets = await getSecretsModule();
    const secretKey = secrets?.SECRET_KEYS?.[secretKeyName];
    if (!secrets?.writeSecret || !secretKey) throw new Error(`当前 SillyTavern 未提供 ${secretKeyName} Secret Store。`);
    return await secrets.writeSecret(secretKey, key, label);
}
function getRequestHeaders(ctx) { return typeof ctx?.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' }; }
function extractModels(payload) {
    const rows = [payload?.data, payload?.models, payload?.model_list, payload].find(Array.isArray) || [];
    const ids = rows.map(row => typeof row === 'string' ? row : (row?.id || row?.model || row?.name || row?.slug || '')).map(String).map(x => x.trim()).filter(Boolean);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

// Chat-completion model discovery is valid only for the summary connection. Never use this path
// for an embedding-only endpoint: doing so caused Jina /v1/embeddings to be reported as a bad chat endpoint.
async function fetchSummaryModels(ctx, url, customSecretId) {
    const base = normalizeUrl(url);
    if (!base || !customSecretId) throw new Error('请先填写接口地址并保存 API Key。');
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST', headers: getRequestHeaders(ctx),
        body: JSON.stringify({ chat_completion_source: 'custom', custom_url: base, secret_id: customSecretId }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`总结接口连接失败：HTTP ${response.status}${text ? ` · ${text.slice(0, 180)}` : ''}`);
    }
    const models = extractModels(await response.json());
    if (!models.length) throw new Error('连接成功，但接口没有返回可识别的聊天模型列表。');
    return models;
}

// Best-effort embedding model discovery. Many embedding providers (including some OpenAI-compatible
// services) expose /v1/embeddings but no /v1/models. Discovery failure is therefore non-fatal.
async function discoverEmbeddingModelsDirect(rawUrl, apiKey) {
    const base = normalizeOpenAiEmbeddingBaseUrl(rawUrl);
    const key = String(apiKey || '').trim();
    if (!base || !key) return [];
    try {
        const response = await fetch(`${base}/models`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        });
        if (!response.ok) return [];
        return extractModels(await response.json());
    } catch {
        // Browser CORS or a provider without /models: manual model entry remains available.
        return [];
    }
}

function ensureConnectionManager(ctx) {
    if (!ctx.extensionSettings.connectionManager || typeof ctx.extensionSettings.connectionManager !== 'object') ctx.extensionSettings.connectionManager = { profiles: [], selectedProfile: null };
    const manager = ctx.extensionSettings.connectionManager;
    if (!Array.isArray(manager.profiles)) manager.profiles = [];
    return manager;
}
function upsertSummaryProfile(ctx, settings) {
    const manager = ensureConnectionManager(ctx);
    let profile = manager.profiles.find(row => row.id === settings.summary_direct_api_profile_id) || manager.profiles.find(row => row.name === SUMMARY_PROFILE_NAME);
    if (!profile) { profile = { id: uuid(), mode: 'cc', name: SUMMARY_PROFILE_NAME, exclude: [] }; manager.profiles.push(profile); }
    Object.assign(profile, { mode: 'cc', name: SUMMARY_PROFILE_NAME, api: 'custom', model: settings.summary_direct_api_model, 'api-url': normalizeUrl(settings.summary_direct_api_url), 'secret-id': settings.summary_direct_api_secret_id, 'prompt-post-processing': '', exclude: [] });
    settings.summary_direct_api_profile_id = profile.id;
    settings.summary_provider_mode = 'connection_profile';
    settings.summary_connection_profile_id = profile.id;
    ctx.saveSettingsDebounced?.();
    return profile;
}

export function applyDirectVectorTransport(ctxInput = getContext()) { return configurePrivateVectorTransport(ctxInput).active === true; }
async function vectorRequest(ctx, endpoint, body) {
    const response = await fetch(`/api/vector/${endpoint}`, { method: 'POST', headers: getRequestHeaders(ctx), body: JSON.stringify(body) });
    if (!response.ok) { const text = await response.text().catch(() => ''); throw new Error(`Embedding 验证失败：HTTP ${response.status}${text ? ` · ${text.slice(0, 220)}` : ''}`); }
    if (response.status === 204) return null;
    const type = response.headers.get('content-type') || '';
    return type.includes('application/json') ? await response.json() : await response.text();
}
export async function probeDirectVectorTransport(ctxInput = getContext()) {
    const ctx = ctxInput; const settings = ensureSettings(ctx);
    if (!ctx || !settings) throw new Error('SillyTavern Context 不可用。');
    if (!applyDirectVectorTransport(ctx)) throw new Error('请先填写向量 API 地址、API Key 和 Embedding 模型。');
    const collectionId = `${VECTOR_TEST_PREFIX}${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const item = { hash: 904211, text: 'Aetheria embedding connectivity probe.', index: 0 };
    const apiUrl = normalizeOpenAiEmbeddingBaseUrl(settings.vector_direct_api_url);
    try {
        await vectorRequest(ctx, 'insert', { source: 'vllm', apiUrl, model: settings.vector_direct_api_model, collectionId, items: [item] });
        const result = await vectorRequest(ctx, 'query', { source: 'vllm', apiUrl, model: settings.vector_direct_api_model, collectionId, searchText: item.text, topK: 1, threshold: 0 });
        if (!Array.isArray(result?.metadata) || !result.metadata.length) throw new Error('Embedding 请求成功，但测试集合没有返回检索结果。');
        return true;
    } finally { await vectorRequest(ctx, 'purge', { collectionId }).catch(() => {}); }
}

function fillModelList(list, models) {
    if (!list) return;
    list.replaceChildren();
    for (const model of models || []) { const option = document.createElement('option'); option.value = model; list.append(option); }
}
function status(root, kind, message, ok = null) {
    const el = root?.querySelector(`#aum-v55-${kind}-direct-status`); if (!el) return;
    el.textContent = message; el.dataset.state = ok === true ? 'ok' : ok === false ? 'error' : 'idle';
}
function createConnectionBlock(kind, title, description) {
    const isSummary = kind === 'summary';
    const modelHelp = isSummary ? '连接成功后自动拉取模型列表。' : '会尝试自动发现模型；若供应商不提供 /models（Jina 等情况可能如此），可直接手动填写 Embedding 模型名。';
    const placeholder = isSummary ? 'https://api.example.com/v1' : 'https://api.jina.ai/v1 或 https://api.jina.ai/v1/embeddings';
    const block = document.createElement('section'); block.className = 'aum-v55-direct-api-block'; block.dataset.kind = kind;
    block.innerHTML = `<div class="aum-v55-direct-api-header"><div><strong>${title}</strong><small>${description}</small></div><label class="checkbox_label"><input id="aum-v55-${kind}-direct-enabled" type="checkbox"> 使用独立接口</label></div><div class="aum-v51-grid aum-v55-direct-api-grid"><label>接口模式<select id="aum-v55-${kind}-direct-mode" class="text_pole"><option value="openai_compatible">OpenAI 兼容</option></select></label><label>接口地址<input id="aum-v55-${kind}-direct-url" class="text_pole" type="url" placeholder="${placeholder}"></label><label>API Key<input id="aum-v55-${kind}-direct-key" class="text_pole" type="password" autocomplete="new-password" placeholder="sk-..."></label><label>模型<input id="aum-v55-${kind}-direct-model" class="text_pole" type="text" list="aum-v55-${kind}-direct-model-list" placeholder="${isSummary ? '连接后选择或填写模型' : '例如 jina-embeddings-v3'}"><datalist id="aum-v55-${kind}-direct-model-list"></datalist><small>${modelHelp}</small></label></div><div class="aum-v51-buttons aum-v55-direct-api-actions"><button id="aum-v55-${kind}-direct-connect" class="menu_button">保存密钥并连接</button><button id="aum-v55-${kind}-direct-refresh" class="menu_button">重新发现模型</button>${isSummary ? '<button id="aum-v55-summary-direct-apply" class="menu_button">设为总结接口</button>' : '<button id="aum-v55-vector-direct-test" class="menu_button">测试 Embedding</button>'}</div><div id="aum-v55-${kind}-direct-status" class="aum-v51-status">尚未连接。</div>`;
    return block;
}
async function saveConnectionSecret(kind, key) {
    if (kind === 'summary') { const id = await saveSecret('CUSTOM', key, 'Aetheria Summary API'); return { runtimeSecretId: id, probeSecretId: id }; }
    const runtimeSecretId = await saveSecret('VLLM', key, 'Aetheria Vector API');
    const probeSecretId = await saveSecret('CUSTOM', key, 'Aetheria Vector Model Discovery');
    return { runtimeSecretId, probeSecretId };
}

async function connectSummary(ctx, settings, root, key) {
    let secretId = settings.summary_direct_api_secret_id;
    if (key) secretId = (await saveConnectionSecret('summary', key)).runtimeSecretId;
    if (!secretId) throw new Error('请填写 API Key。');
    settings.summary_direct_api_secret_id = secretId;
    settings.summary_direct_api_enabled = true;
    status(root, 'summary', '正在连接并拉取聊天模型…');
    const models = await fetchSummaryModels(ctx, settings.summary_direct_api_url, secretId);
    settings.summary_direct_api_models = models;
    fillModelList(root.querySelector('#aum-v55-summary-direct-model-list'), models);
    if (!settings.summary_direct_api_model && models.length === 1) settings.summary_direct_api_model = models[0];
    if (settings.summary_direct_api_model) upsertSummaryProfile(ctx, settings);
    status(root, 'summary', `连接成功，发现 ${models.length} 个聊天模型。`, true);
}

async function connectVector(ctx, settings, root, key) {
    let runtimeSecretId = settings.vector_direct_api_secret_id;
    let probeSecretId = settings.vector_direct_api_probe_secret_id;
    let discovered = [];
    if (key) {
        // Try provider-native /models before clearing the plaintext input. Failure is intentionally silent.
        discovered = await discoverEmbeddingModelsDirect(settings.vector_direct_api_url, key);
        const saved = await saveConnectionSecret('vector', key);
        runtimeSecretId = saved.runtimeSecretId; probeSecretId = saved.probeSecretId;
    }
    if (!runtimeSecretId) throw new Error('请填写 API Key。');
    settings.vector_direct_api_secret_id = runtimeSecretId;
    settings.vector_direct_api_probe_secret_id = probeSecretId || '';
    settings.vector_direct_api_enabled = true;
    settings.vector_direct_api_url = normalizeOpenAiEmbeddingBaseUrl(settings.vector_direct_api_url);
    if (discovered.length) settings.vector_direct_api_models = discovered;
    fillModelList(root.querySelector('#aum-v55-vector-direct-model-list'), settings.vector_direct_api_models);
    configurePrivateVectorTransport(ctx);
    if (settings.vector_direct_api_model) {
        status(root, 'vector', '连接已保存，正在进行真实 Embedding 测试…');
        await probeDirectVectorTransport(ctx);
        status(root, 'vector', `Embedding 连接成功：${settings.vector_direct_api_model}`, true);
    } else {
        status(root, 'vector', discovered.length ? `连接已保存，发现 ${discovered.length} 个模型；请选择或填写 Embedding 模型后测试。` : '连接已保存。该供应商未提供可用的模型枚举，请手动填写 Embedding 模型名后点击“测试 Embedding”。', true);
    }
}

function mountCard() {
    if (typeof document === 'undefined') return false;
    const ctx = getContext(); const settings = ensureSettings(ctx);
    const page = document.getElementById('aum-v55-settings-page-memory') || document.querySelector('#aum-v54-settings .inline-drawer-content');
    if (!ctx || !settings || !page) return false;
    let root = document.getElementById('aum-v55-direct-api-settings');
    if (!root) {
        root = document.createElement('section'); root.id = 'aum-v55-direct-api-settings'; root.className = 'aum-v54-section aum-v55-direct-api-settings';
        const heading = document.createElement('div'); heading.className = 'aum-v55-direct-api-title'; heading.innerHTML = '<h4>独立 API 连接</h4><p class="aum-v51-muted">总结 API 与 Embedding API 分开探测。向量接口不会再拿 Chat Completions 状态接口验证，因此 Jina 这类纯 Embedding 服务不会被误报为聊天端点错误。</p>';
        root.append(heading, createConnectionBlock('summary', '总结 API', '用于一级 / 二级 / 三级后台总结。'), createConnectionBlock('vector', '向量 API', '仅用于 Aetheria Memory、Baseline、Setting 三条 Dense / Embedding 检索链路。'));
        page.prepend(root);

        for (const kind of ['summary', 'vector']) {
            root.querySelector(`#aum-v55-${kind}-direct-enabled`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_enabled`] = Boolean(event.target.checked);
                if (kind === 'summary' && !event.target.checked) { settings.summary_provider_mode = 'current'; settings.summary_connection_profile_id = ''; }
                if (kind === 'vector') { configurePrivateVectorTransport(ctx); invalidateAetheriaVectorState(ctx, event.target.checked ? '已启用独立 Embedding，需要按私有向量空间重建。' : '已关闭独立 Embedding，需要恢复宿主 provider 的派生向量。'); }
                ctx.saveSettingsDebounced?.(); renderDirectApiSettings();
            });
            root.querySelector(`#aum-v55-${kind}-direct-url`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_url`] = kind === 'vector' ? normalizeOpenAiEmbeddingBaseUrl(event.target.value) : normalizeUrl(event.target.value);
                if (kind === 'vector' && settings.vector_direct_api_enabled) { configurePrivateVectorTransport(ctx); invalidateAetheriaVectorState(ctx); }
                ctx.saveSettingsDebounced?.(); renderDirectApiSettings();
            });
            root.querySelector(`#aum-v55-${kind}-direct-model`)?.addEventListener('change', async event => {
                settings[`${kind}_direct_api_model`] = String(event.target.value || '').trim();
                if (kind === 'summary' && settings.summary_direct_api_enabled && settings.summary_direct_api_model) upsertSummaryProfile(ctx, settings);
                if (kind === 'vector' && settings.vector_direct_api_enabled && settings.vector_direct_api_model) { configurePrivateVectorTransport(ctx); invalidateAetheriaVectorState(ctx); }
                ctx.saveSettingsDebounced?.();
            });
            root.querySelector(`#aum-v55-${kind}-direct-connect`)?.addEventListener('click', async () => {
                const keyEl = root.querySelector(`#aum-v55-${kind}-direct-key`);
                try {
                    const urlEl = root.querySelector(`#aum-v55-${kind}-direct-url`);
                    settings[`${kind}_direct_api_url`] = kind === 'vector' ? normalizeOpenAiEmbeddingBaseUrl(urlEl.value) : normalizeUrl(urlEl.value);
                    if (!settings[`${kind}_direct_api_url`]) throw new Error('请填写接口地址。');
                    const key = String(keyEl.value || '').trim();
                    if (kind === 'summary') await connectSummary(ctx, settings, root, key); else await connectVector(ctx, settings, root, key);
                    keyEl.value = ''; ctx.saveSettingsDebounced?.(); renderDirectApiSettings();
                } catch (error) { status(root, kind, String(error?.message || error), false); }
            });
            root.querySelector(`#aum-v55-${kind}-direct-refresh`)?.addEventListener('click', async () => {
                try {
                    if (kind === 'summary') {
                        const models = await fetchSummaryModels(ctx, settings.summary_direct_api_url, settings.summary_direct_api_secret_id);
                        settings.summary_direct_api_models = models; fillModelList(root.querySelector('#aum-v55-summary-direct-model-list'), models); status(root, kind, `模型列表已刷新，共 ${models.length} 个。`, true);
                    } else {
                        status(root, kind, 'Embedding 模型枚举需要供应商支持 /models。若当前列表为空，请直接手动填写模型名；连接有效性以“测试 Embedding”为准。');
                    }
                    ctx.saveSettingsDebounced?.();
                } catch (error) { status(root, kind, String(error?.message || error), false); }
            });
        }
        root.querySelector('#aum-v55-summary-direct-apply')?.addEventListener('click', () => { try { if (!settings.summary_direct_api_model) throw new Error('请先选择或填写总结模型。'); const profile = upsertSummaryProfile(ctx, settings); status(root, 'summary', `已设为总结接口：${profile.model}`, true); } catch (error) { status(root, 'summary', String(error?.message || error), false); } });
        root.querySelector('#aum-v55-vector-direct-test')?.addEventListener('click', async () => { try { status(root, 'vector', '正在测试真实 Embedding 写入 / 查询…'); await probeDirectVectorTransport(ctx); status(root, 'vector', `Embedding 测试成功：${settings.vector_direct_api_model}`, true); notify('success', 'Aetheria 私有向量 API 已通过 Embedding 写入与检索测试。'); } catch (error) { status(root, 'vector', String(error?.message || error), false); } });
    }
    mounted = true; configurePrivateVectorTransport(ctx); renderDirectApiSettings(); return true;
}

export function renderDirectApiSettings() {
    if (typeof document === 'undefined') return false;
    const ctx = getContext(); const settings = ensureSettings(ctx); const root = document.getElementById('aum-v55-direct-api-settings');
    if (!ctx || !settings || !root) return false;
    const privateStatus = getPrivateVectorTransportStatus(ctx);
    for (const kind of ['summary', 'vector']) {
        root.querySelector(`#aum-v55-${kind}-direct-enabled`).checked = Boolean(settings[`${kind}_direct_api_enabled`]);
        root.querySelector(`#aum-v55-${kind}-direct-mode`).value = settings[`${kind}_direct_api_mode`] || 'openai_compatible';
        root.querySelector(`#aum-v55-${kind}-direct-url`).value = settings[`${kind}_direct_api_url`] || '';
        root.querySelector(`#aum-v55-${kind}-direct-model`).value = settings[`${kind}_direct_api_model`] || '';
        fillModelList(root.querySelector(`#aum-v55-${kind}-direct-model-list`), settings[`${kind}_direct_api_models`] || []);
        const keyEl = root.querySelector(`#aum-v55-${kind}-direct-key`); keyEl.placeholder = settings[`${kind}_direct_api_secret_id`] ? '密钥已安全保存；留空表示不更换' : 'sk-...';
        root.querySelector(`[data-kind="${kind}"]`)?.classList.toggle('aum-v55-direct-api-disabled', !settings[`${kind}_direct_api_enabled`]);
        if (settings[`${kind}_direct_api_secret_id`] && settings[`${kind}_direct_api_url`]) {
            const suffix = settings[`${kind}_direct_api_model`] ? ` / ${settings[`${kind}_direct_api_model`]}` : '';
            const active = kind === 'vector' && privateStatus.active ? '；Aetheria 私有 transport 已启用' : '';
            status(root, kind, `已保存连接：${settings[`${kind}_direct_api_url`]}${suffix}${active}`, true);
        }
    }
    return true;
}
export function installV55DirectApiSettings() { if (mountCard()) return true; for (const delay of [120, 350, 800, 1500, 2600]) setTimeout(mountCard, delay); return mounted; }
