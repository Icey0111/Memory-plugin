// v5.5 iteration08 staged entry point.
// Load the proven v5.4/v5.5-A..G runtime, then layer the v5.5 hardening/finalizer
// boundaries without rewriting the mature legacy entry point.
import { init as legacyInit } from './index.js';
import { fnv1a32Runtime, installV55Runtime } from './v55-runtime.js';
import { buildSceneSummaries, installV55Finalizer } from './v55-finalizer.js';
import { installV55Consistency } from './v55-consistency.js';
import { installV55Provenance } from './v55-provenance.js';

const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
const LEGACY_EXTENSION_PATH = 'third-party/aetheria-unified-memory-v5_4';
const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';

export function resolveRuntimeExtensionPath(url = import.meta.url) {
    try {
        const pathname = new URL(url, globalThis.location?.href || undefined).pathname;
        const marker = '/scripts/extensions/';
        const markerIndex = pathname.lastIndexOf(marker);
        if (markerIndex < 0) return null;
        const relative = decodeURIComponent(pathname.slice(markerIndex + marker.length));
        const parts = relative.split('/').filter(Boolean);
        if (parts.length < 2) return null;
        parts.pop();
        return parts.join('/');
    } catch {
        return null;
    }
}

const RUNTIME_EXTENSION_PATH = resolveRuntimeExtensionPath();
let contextCompatibilityInstalled = false;

function installContextCompatibility() {
    if (contextCompatibilityInstalled) return true;
    const st = globalThis.SillyTavern;
    if (!st || typeof st.getContext !== 'function') return false;

    const originalGetContext = st.getContext.bind(st);
    st.getContext = (...args) => {
        const ctx = originalGetContext(...args);
        if (!ctx || typeof ctx !== 'object') return ctx;
        if (!RUNTIME_EXTENSION_PATH || typeof ctx.renderExtensionTemplateAsync !== 'function') return ctx;
        if (ctx.renderExtensionTemplateAsync.__aumV55PathCompat) return ctx;

        const originalRender = ctx.renderExtensionTemplateAsync.bind(ctx);
        const wrappedRender = (extensionName, templateId, ...rest) => {
            const actualName = extensionName === LEGACY_EXTENSION_PATH ? RUNTIME_EXTENSION_PATH : extensionName;
            return originalRender(actualName, templateId, ...rest);
        };
        wrappedRender.__aumV55PathCompat = true;
        ctx.renderExtensionTemplateAsync = wrappedRender;
        return ctx;
    };
    contextCompatibilityInstalled = true;
    return true;
}

const getContext = () => globalThis.SillyTavern?.getContext?.();
let stackInstalled = false;
let dashboardEventsInstalled = false;

function getSettingsContent() {
    const root = document.getElementById('aum-v54-settings');
    if (!root) return null;
    return root.querySelector(':scope > .inline-drawer-content') || root.querySelector('.inline-drawer-content');
}

function summarizeRuntime(ctx) {
    const settings = ctx?.extensionSettings?.[SETTINGS_KEY] || {};
    const store = ctx?.chatMetadata?.[METADATA_KEY] || {};
    const binding = store.setting_binding || {};
    const identity = store.runtime_identity || {};
    const provenance = store.provenance_registry || {};
    const consistency = store.v55_consistency || store.v55_finalizer_diagnostics || null;
    const settingIndex = settings.setting_index_state || {};
    const activeScopeKey = settingIndex.active_scope_key || null;
    const activeScope = activeScopeKey ? settingIndex.scopes?.[activeScopeKey] || null : null;
    const activeProfile = activeScope?.active_profile_hash
        ? activeScope.profiles?.[activeScope.active_profile_hash] || null
        : null;
    const overlays = settings.setting_entry_overrides && typeof settings.setting_entry_overrides === 'object'
        ? Object.keys(settings.setting_entry_overrides).length
        : 0;
    const scenes = Array.isArray(store.scene_summaries) ? store.scene_summaries : [];
    const memories = store.memories && typeof store.memories === 'object' ? Object.keys(store.memories).length : 0;
    const transactions = store.extractions && typeof store.extractions === 'object' ? Object.keys(store.extractions).length : 0;
    return {
        extension_path: RUNTIME_EXTENSION_PATH,
        path_compatibility: Boolean(RUNTIME_EXTENSION_PATH && contextCompatibilityInstalled),
        stack_installed: stackInstalled,
        chat_id: String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '') || null,
        world_id: binding.world_id || null,
        baseline_revision_id: binding.baseline_revision_id || null,
        extension_revision_ids: Array.isArray(binding.extension_revision_ids) ? binding.extension_revision_ids : [],
        branch_id: identity.branch_id || null,
        setting_overlays: overlays,
        setting_scope_key: activeScopeKey,
        setting_vector_profile: activeScope?.active_profile_hash || null,
        setting_vector_ready: Boolean(activeProfile?.ready && activeProfile?.stale === false && activeProfile?.collection_id),
        memories,
        extraction_transactions: transactions,
        scene_summaries: scenes.length,
        provenance_memories: Object.keys(provenance.memories || {}).length,
        provenance_transactions: Object.keys(provenance.transactions || {}).length,
        last_consistency_at: consistency?.at || null,
        selected_scene_ids: consistency?.selected_scene_ids || [],
    };
}

function renderRuntimeDashboard(ctx = getContext()) {
    const root = document.getElementById('aum-v55-runtime-dashboard');
    if (!root || !ctx) return false;
    const status = root.querySelector('#aum-v55-runtime-summary');
    const details = root.querySelector('#aum-v55-runtime-details');
    const data = summarizeRuntime(ctx);
    const pathLabel = data.extension_path || '未解析';
    const worldLabel = data.world_id || '未绑定';
    const denseLabel = data.setting_vector_ready ? 'Dense 已就绪' : 'Dense 未就绪 / 词法可用';
    if (status) {
        status.textContent = `路径 ${pathLabel} ｜ World ${worldLabel} ｜ 记忆 ${data.memories} ｜ 抽取 ${data.extraction_transactions} ｜ 场景 ${data.scene_summaries} ｜ Overlay ${data.setting_overlays} ｜ ${denseLabel}`;
    }
    if (details) details.textContent = JSON.stringify(data, null, 2);
    return true;
}

function mountRuntimeDashboard(ctx = getContext()) {
    if (typeof document === 'undefined') return false;
    const content = getSettingsContent();
    if (!content || document.getElementById('aum-v55-runtime-dashboard')) {
        renderRuntimeDashboard(ctx);
        return Boolean(document.getElementById('aum-v55-runtime-dashboard'));
    }

    const section = document.createElement('section');
    section.id = 'aum-v55-runtime-dashboard';
    section.className = 'aum-v54-section aum-v55-runtime-dashboard';
    section.innerHTML = `
        <h4>v5.5 运行状态</h4>
        <small>用于确认扩展路径、聊天绑定、Setting Index、场景摘要与 provenance 是否已经真正接入宿主。这里展示的是派生运行状态，不会修改聊天正文。</small>
        <div id="aum-v55-runtime-summary" class="aum-v51-status">正在读取 v5.5 运行状态…</div>
        <div class="aum-v51-buttons">
            <button id="aum-v55-runtime-refresh" class="menu_button">刷新运行状态</button>
            <button id="aum-v55-runtime-rebuild-scenes" class="menu_button">重建场景摘要</button>
            <button id="aum-v55-runtime-remount-ui" class="menu_button">重新整理前端</button>
        </div>
        <details>
            <summary>v5.5 Runtime diagnostics</summary>
            <pre id="aum-v55-runtime-details" class="aum-v51-diagnostics">无。</pre>
        </details>`;
    content.prepend(section);

    section.querySelector('#aum-v55-runtime-refresh')?.addEventListener('click', () => renderRuntimeDashboard(getContext()));
    section.querySelector('#aum-v55-runtime-remount-ui')?.addEventListener('click', () => {
        normalizeSettingsUi();
        renderRuntimeDashboard(getContext());
    });
    section.querySelector('#aum-v55-runtime-rebuild-scenes')?.addEventListener('click', () => {
        const current = getContext();
        const store = current?.chatMetadata?.[METADATA_KEY];
        if (!current || !store) return;
        const scenes = buildSceneSummaries(store);
        store.scene_summaries = scenes;
        store.scene_summary_source = 'manual-runtime-dashboard-rebuild';
        store.scene_summary_fingerprint = `scenes_${fnv1a32Runtime(scenes.map(scene => scene.fingerprint).join('|')).toString(36)}`;
        current.saveMetadataDebounced?.();
        renderRuntimeDashboard(current);
        const toast = globalThis.toastr;
        if (toast?.success) toast.success(`已重建 ${scenes.length} 个场景摘要。`, 'Aetheria v5.5');
    });
    renderRuntimeDashboard(ctx);
    return true;
}

function normalizeSettingsUi() {
    if (typeof document === 'undefined') return false;
    const root = document.getElementById('aum-v54-settings');
    if (!root) return false;
    const content = getSettingsContent();
    if (!content) return false;

    const header = root.querySelector(':scope > .inline-drawer-toggle.inline-drawer-header') || root.querySelector('.inline-drawer-toggle.inline-drawer-header');
    if (header && !header.querySelector('.aum-v55-brand-icon')) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-brain aum-v55-brand-icon';
        icon.title = 'Aetheria Unified Memory';
        icon.setAttribute('aria-hidden', 'true');
        header.prepend(icon);
    }

    const dashboard = document.getElementById('aum-v55-runtime-dashboard');
    const binding = document.getElementById('aum-v55-chat-binding');
    const editor = document.getElementById('aum-v55-entry-editor');

    if (dashboard && dashboard.parentElement !== content) content.prepend(dashboard);
    if (binding && binding.parentElement !== content) {
        if (dashboard?.parentElement === content) dashboard.insertAdjacentElement('afterend', binding);
        else content.prepend(binding);
    }
    if (editor && editor.parentElement !== content) {
        if (binding?.parentElement === content) binding.insertAdjacentElement('afterend', editor);
        else if (dashboard?.parentElement === content) dashboard.insertAdjacentElement('afterend', editor);
        else content.prepend(editor);
    }
    return true;
}

function scheduleUiNormalization() {
    for (const delay of [0, 250, 900, 1300, 1800, 2600]) {
        setTimeout(() => {
            mountRuntimeDashboard(getContext());
            normalizeSettingsUi();
            renderRuntimeDashboard(getContext());
        }, delay);
    }
}

function installDashboardEvents(ctx) {
    if (dashboardEventsInstalled || !ctx?.eventSource?.on) return false;
    const events = ctx.eventTypes || {};
    const schedule = () => setTimeout(() => {
        mountRuntimeDashboard(getContext());
        normalizeSettingsUi();
        renderRuntimeDashboard(getContext());
    }, 60);
    for (const event of [
        events.APP_READY,
        events.CHAT_CHANGED,
        events.MESSAGE_RECEIVED,
        events.CHARACTER_MESSAGE_RENDERED,
        events.MESSAGE_SWIPED,
        events.MESSAGE_EDITED,
        events.MESSAGE_UPDATED,
        events.MESSAGE_DELETED,
    ]) {
        if (event) ctx.eventSource.on(event, schedule);
    }
    dashboardEventsInstalled = true;
    return true;
}

function installAll() {
    installContextCompatibility();
    if (stackInstalled) {
        const ctx = getContext();
        installDashboardEvents(ctx);
        scheduleUiNormalization();
        return true;
    }
    const ctx = getContext();
    const base = globalThis[INTERCEPTOR_NAME];
    if (!ctx || typeof base !== 'function') return false;

    // Fixed order: compatibility runtime -> v5.5 feature finalizer -> post-runtime
    // consistency -> provenance event stabilizer. Install exactly once.
    installV55Runtime(getContext, INTERCEPTOR_NAME);
    installV55Finalizer(getContext, INTERCEPTOR_NAME);
    installV55Consistency(getContext, INTERCEPTOR_NAME);
    installV55Provenance(getContext);
    stackInstalled = true;
    installDashboardEvents(ctx);
    scheduleUiNormalization();
    return true;
}

export function init() {
    installContextCompatibility();
    const result = legacyInit();
    installAll();
    scheduleUiNormalization();
    return result;
}

installContextCompatibility();
installAll();
setTimeout(installAll, 50);
setTimeout(installAll, 800);
setTimeout(installAll, 1600);
