// Aetheria Unified Memory v5.5 — independent API connection settings.
// Provides SillyTavern-like OpenAI-compatible connection controls for summarization and embeddings.
// API keys are stored through SillyTavern's secret store; only returned secret IDs are kept in extension settings.

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const SUMMARY_PROFILE_NAME = 'Aetheria · Summary API';

const DEFAULTS = Object.freeze({
    summary_direct_api_enabled: false,
    summary_direct_api_mode: 'openai_compatible',
    summary_direct_api_url: '',
    summary_direct_api_model: '',
    summary_direct_api_secret_id: '',
    summary_direct_api_profile_id: '',
    vector_direct_api_enabled: false,
    vector_direct_api_mode: 'openai_compatible',
    vector_direct_api_url: '',
    vector_direct_api_model: '',
    vector_direct_api_secret_id: '',
});

let secretsModulePromise = null;
let mounted = false;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function ensureSettings(ctx) {
    if (!ctx?.extensionSettings) return null;
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        ctx.extensionSettings[SETTINGS_KEY] = {};
    }
    const settings = ctx.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULTS)) if (settings[key] === undefined) settings[key] = value;
    return settings;
}

function normalizeUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function uuid() {
    return globalThis.crypto?.randomUUID?.() || `aum-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function getSecretsModule() {
    if (!secretsModulePromise) secretsModulePromise = import('/scripts/secrets.js').catch(() => null);
    return secretsModulePromise;
}

async function saveCustomSecret(value, label) {
    const key = String(value || '').trim();
    if (!key) return null;
    const secrets = await getSecretsModule();
    if (!secrets?.writeSecret || !secrets?.SECRET_KEYS?.CUSTOM) {
        throw new Error('当前 SillyTavern 未提供可用的安全 Secret Store。');
    }
    return await secrets.writeSecret(secrets.SECRET_KEYS.CUSTOM, key, label);
}

function getRequestHeaders(ctx) {
    return typeof ctx?.getRequestHeaders === 'function'
        ? ctx.getRequestHeaders()
        : { 'Content-Type': 'application/json' };
}

function extractModels(payload) {
    const candidates = [payload?.data, payload?.models, payload?.model_list, payload];
    const rows = candidates.find(Array.isArray) || [];
    const ids = rows.map(row => {
        if (typeof row === 'string') return row;
        return row?.id || row?.model || row?.name || '';
    }).map(String).map(x => x.trim()).filter(Boolean);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function fetchOpenAiCompatibleModels(ctx, url, secretId) {
    const base = normalizeUrl(url);
    if (!base) throw new Error('请先填写接口地址。');
    if (!secretId) throw new Error('请先保存 API Key。');
    const response = await fetch('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: getRequestHeaders(ctx),
        body: JSON.stringify({
            chat_completion_source: 'custom',
            custom_url: base,
            secret_id: secretId,
        }),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`连接失败：HTTP ${response.status}${text ? ` · ${text.slice(0, 180)}` : ''}`);
    }
    const payload = await response.json();
    const models = extractModels(payload);
    if (!models.length) throw new Error('连接成功，但接口没有返回可识别的模型列表。');
    return models;
}

function ensureConnectionManager(ctx) {
    if (!ctx.extensionSettings.connectionManager || typeof ctx.extensionSettings.connectionManager !== 'object') {
        ctx.extensionSettings.connectionManager = { profiles: [], selectedProfile: null };
    }
    const manager = ctx.extensionSettings.connectionManager;
    if (!Array.isArray(manager.profiles)) manager.profiles = [];
    return manager;
}

function upsertSummaryProfile(ctx, settings) {
    const manager = ensureConnectionManager(ctx);
    let profile = manager.profiles.find(row => row.id === settings.summary_direct_api_profile_id);
    if (!profile) {
        profile = manager.profiles.find(row => row.name === SUMMARY_PROFILE_NAME);
    }
    if (!profile) {
        profile = { id: uuid(), mode: 'cc', name: SUMMARY_PROFILE_NAME, exclude: [] };
        manager.profiles.push(profile);
    }
    Object.assign(profile, {
        mode: 'cc',
        name: SUMMARY_PROFILE_NAME,
        api: 'custom',
        model: settings.summary_direct_api_model,
        'api-url': normalizeUrl(settings.summary_direct_api_url),
        'secret-id': settings.summary_direct_api_secret_id,
        'prompt-post-processing': '',
        exclude: [],
    });
    settings.summary_direct_api_profile_id = profile.id;
    settings.summary_provider_mode = 'connection_profile';
    settings.summary_connection_profile_id = profile.id;
    ctx.saveSettingsDebounced?.();
    return profile;
}

function updateSelect(select, models, current) {
    const keep = String(current || '');
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = models.length ? '请选择模型' : '连接后自动拉取模型';
    select.append(placeholder);
    for (const model of models) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        select.append(option);
    }
    if (keep && !models.includes(keep)) {
        const option = document.createElement('option');
        option.value = keep;
        option.textContent = `${keep}（当前配置）`;
        select.append(option);
    }
    select.value = keep;
}

function status(root, kind, message, ok = null) {
    const el = root.querySelector(`#aum-v55-${kind}-direct-status`);
    if (!el) return;
    el.textContent = message;
    el.dataset.state = ok === true ? 'ok' : ok === false ? 'error' : 'idle';
}

function createConnectionBlock(kind, title, description) {
    const isSummary = kind === 'summary';
    const block = document.createElement('section');
    block.className = 'aum-v55-direct-api-block';
    block.dataset.kind = kind;
    block.innerHTML = `
        <div class="aum-v55-direct-api-header">
            <div><strong>${title}</strong><small>${description}</small></div>
            <label class="checkbox_label"><input id="aum-v55-${kind}-direct-enabled" type="checkbox"> 使用独立接口</label>
        </div>
        <div class="aum-v51-grid aum-v55-direct-api-grid">
            <label>接口模式
                <select id="aum-v55-${kind}-direct-mode" class="text_pole">
                    <option value="openai_compatible">OpenAI 兼容</option>
                </select>
            </label>
            <label>接口地址
                <input id="aum-v55-${kind}-direct-url" class="text_pole" type="url" placeholder="https://api.example.com/v1">
            </label>
            <label>API Key
                <input id="aum-v55-${kind}-direct-key" class="text_pole" type="password" autocomplete="new-password" placeholder="sk-...">
            </label>
            <label>模型
                <select id="aum-v55-${kind}-direct-model" class="text_pole"><option value="">连接后自动拉取模型</option></select>
            </label>
        </div>
        <div class="aum-v51-buttons aum-v55-direct-api-actions">
            <button id="aum-v55-${kind}-direct-connect" class="menu_button">保存密钥并连接</button>
            <button id="aum-v55-${kind}-direct-refresh" class="menu_button">重新拉取模型</button>
            ${isSummary ? '<button id="aum-v55-summary-direct-apply" class="menu_button">设为总结接口</button>' : ''}
        </div>
        <div id="aum-v55-${kind}-direct-status" class="aum-v51-status">尚未连接。</div>`;
    return block;
}

function mountCard() {
    if (typeof document === 'undefined') return false;
    const ctx = getContext();
    const settings = ensureSettings(ctx);
    const page = document.getElementById('aum-v55-settings-page-memory') || document.querySelector('#aum-v54-settings .inline-drawer-content');
    if (!ctx || !settings || !page) return false;

    let root = document.getElementById('aum-v55-direct-api-settings');
    if (!root) {
        root = document.createElement('section');
        root.id = 'aum-v55-direct-api-settings';
        root.className = 'aum-v54-section aum-v55-direct-api-settings';
        const heading = document.createElement('div');
        heading.className = 'aum-v55-direct-api-title';
        heading.innerHTML = '<h4>独立 API 连接</h4><p class="aum-v51-muted">像酒馆的 API 设置一样：选择接口模式、填写地址和 API Key，连接成功后自动拉取模型列表。总结模型和向量模型分别配置，互不绑定。</p>';
        root.append(heading,
            createConnectionBlock('summary', '总结 API', '用于一级/二级/三级后台总结。'),
            createConnectionBlock('vector', '向量 API', '用于 Embedding / Dense 检索。'));
        page.prepend(root);

        for (const kind of ['summary', 'vector']) {
            root.querySelector(`#aum-v55-${kind}-direct-enabled`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_enabled`] = Boolean(event.target.checked);
                if (kind === 'summary' && !event.target.checked) {
                    settings.summary_provider_mode = 'current';
                    settings.summary_connection_profile_id = '';
                }
                ctx.saveSettingsDebounced?.();
                renderDirectApiSettings();
            });
            root.querySelector(`#aum-v55-${kind}-direct-mode`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_mode`] = String(event.target.value || 'openai_compatible');
                ctx.saveSettingsDebounced?.();
            });
            root.querySelector(`#aum-v55-${kind}-direct-url`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_url`] = normalizeUrl(event.target.value);
                ctx.saveSettingsDebounced?.();
            });
            root.querySelector(`#aum-v55-${kind}-direct-model`)?.addEventListener('change', event => {
                settings[`${kind}_direct_api_model`] = String(event.target.value || '');
                if (kind === 'summary' && settings.summary_direct_api_enabled) upsertSummaryProfile(ctx, settings);
                ctx.saveSettingsDebounced?.();
            });
            root.querySelector(`#aum-v55-${kind}-direct-connect`)?.addEventListener('click', async () => {
                try {
                    const urlEl = root.querySelector(`#aum-v55-${kind}-direct-url`);
                    const keyEl = root.querySelector(`#aum-v55-${kind}-direct-key`);
                    const url = normalizeUrl(urlEl.value);
                    const key = String(keyEl.value || '').trim();
                    if (!url) throw new Error('请填写接口地址。');
                    let secretId = settings[`${kind}_direct_api_secret_id`];
                    if (key) {
                        secretId = await saveCustomSecret(key, `Aetheria ${kind === 'summary' ? 'Summary' : 'Vector'} API`);
                        settings[`${kind}_direct_api_secret_id`] = secretId || '';
                        keyEl.value = '';
                    }
                    if (!secretId) throw new Error('请填写 API Key；保存后密钥会进入 SillyTavern Secret Store。');
                    settings[`${kind}_direct_api_url`] = url;
                    settings[`${kind}_direct_api_enabled`] = true;
                    status(root, kind, '正在连接并拉取模型…');
                    const models = await fetchOpenAiCompatibleModels(ctx, url, secretId);
                    updateSelect(root.querySelector(`#aum-v55-${kind}-direct-model`), models, settings[`${kind}_direct_api_model`]);
                    settings[`${kind}_direct_api_models`] = models;
                    if (!settings[`${kind}_direct_api_model`] && models.length === 1) {
                        settings[`${kind}_direct_api_model`] = models[0];
                        root.querySelector(`#aum-v55-${kind}-direct-model`).value = models[0];
                    }
                    if (kind === 'summary') upsertSummaryProfile(ctx, settings);
                    ctx.saveSettingsDebounced?.();
                    status(root, kind, `连接成功，已拉取 ${models.length} 个模型。`, true);
                    renderDirectApiSettings();
                } catch (error) {
                    status(root, kind, String(error?.message || error), false);
                }
            });
            root.querySelector(`#aum-v55-${kind}-direct-refresh`)?.addEventListener('click', async () => {
                try {
                    const url = normalizeUrl(settings[`${kind}_direct_api_url`]);
                    const secretId = settings[`${kind}_direct_api_secret_id`];
                    status(root, kind, '正在重新拉取模型…');
                    const models = await fetchOpenAiCompatibleModels(ctx, url, secretId);
                    settings[`${kind}_direct_api_models`] = models;
                    updateSelect(root.querySelector(`#aum-v55-${kind}-direct-model`), models, settings[`${kind}_direct_api_model`]);
                    ctx.saveSettingsDebounced?.();
                    status(root, kind, `模型列表已刷新，共 ${models.length} 个。`, true);
                } catch (error) {
                    status(root, kind, String(error?.message || error), false);
                }
            });
        }

        root.querySelector('#aum-v55-summary-direct-apply')?.addEventListener('click', () => {
            try {
                if (!settings.summary_direct_api_url || !settings.summary_direct_api_secret_id || !settings.summary_direct_api_model) {
                    throw new Error('请先完成总结 API 连接并选择模型。');
                }
                settings.summary_direct_api_enabled = true;
                const profile = upsertSummaryProfile(ctx, settings);
                status(root, 'summary', `已设为总结接口：${profile.model}`, true);
                renderDirectApiSettings();
            } catch (error) {
                status(root, 'summary', String(error?.message || error), false);
            }
        });
    }
    mounted = true;
    renderDirectApiSettings();
    return true;
}

export function renderDirectApiSettings() {
    if (typeof document === 'undefined') return false;
    const ctx = getContext();
    const settings = ensureSettings(ctx);
    const root = document.getElementById('aum-v55-direct-api-settings');
    if (!ctx || !settings || !root) return false;

    for (const kind of ['summary', 'vector']) {
        root.querySelector(`#aum-v55-${kind}-direct-enabled`).checked = Boolean(settings[`${kind}_direct_api_enabled`]);
        root.querySelector(`#aum-v55-${kind}-direct-mode`).value = settings[`${kind}_direct_api_mode`] || 'openai_compatible';
        root.querySelector(`#aum-v55-${kind}-direct-url`).value = settings[`${kind}_direct_api_url`] || '';
        const models = Array.isArray(settings[`${kind}_direct_api_models`]) ? settings[`${kind}_direct_api_models`] : [];
        updateSelect(root.querySelector(`#aum-v55-${kind}-direct-model`), models, settings[`${kind}_direct_api_model`]);
        const keyEl = root.querySelector(`#aum-v55-${kind}-direct-key`);
        keyEl.placeholder = settings[`${kind}_direct_api_secret_id`] ? '密钥已安全保存；留空表示不更换' : 'sk-...';
        const block = root.querySelector(`[data-kind="${kind}"]`);
        block?.classList.toggle('aum-v55-direct-api-disabled', !settings[`${kind}_direct_api_enabled`]);
        if (settings[`${kind}_direct_api_secret_id`] && settings[`${kind}_direct_api_url`]) {
            status(root, kind, `已保存连接：${settings[`${kind}_direct_api_url`]}${settings[`${kind}_direct_api_model`] ? ` / ${settings[`${kind}_direct_api_model`]}` : ''}`, true);
        }
    }
    return true;
}

export function installV55DirectApiSettings() {
    if (mountCard()) return true;
    for (const delay of [120, 350, 800, 1500, 2600]) setTimeout(mountCard, delay);
    return mounted;
}
