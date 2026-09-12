// v5.5 iteration08 staged entry point.
// Load the proven v5.4/v5.5-A..G runtime, then layer the v5.5 hardening/finalizer
// boundaries without rewriting the mature legacy entry point.
import { init as legacyInit, createNarrativeHostServices } from './index.js';
import { installNarrativeRuntime, mountNarrativeSettings } from './narrative-runtime.js';

const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
const LEGACY_EXTENSION_PATH = 'third-party/aetheria-unified-memory-v5_4';
const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const SETTINGS_PAGE_KEY = 'aetheria-v55-settings-page';

const SETTINGS_PAGES = Object.freeze([
    { id: 'overview', label: '总览', icon: 'fa-gauge-high' },
    { id: 'memory', label: '记忆', icon: 'fa-brain' },
    { id: 'settings', label: '设定', icon: 'fa-book-open' },
    { id: 'baseline', label: '基线', icon: 'fa-shield-halved' },
    { id: 'advanced', label: '高级', icon: 'fa-sliders' },
    { id: 'diagnostics', label: '诊断', icon: 'fa-stethoscope' },
]);

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
let layoutResizeObserver = null;

function getSettingsContent() {
    const root = document.getElementById('aum-v54-settings');
    if (!root) return null;
    return root.querySelector(':scope > .inline-drawer-content') || root.querySelector('.inline-drawer-content');
}

function getSettingsPage(pageId) {
    return document.querySelector(`#aum-v55-settings-page-${pageId}`);
}

function classifyHeading(textInput) {
    const text = String(textInput || '').trim().toLowerCase();
    if (!text) return null;
    if (text.includes('自动记忆')) return 'memory';
    if (text.includes('插件设定库') || text.includes('plugin setting index')) return 'settings';
    if (text.includes('semantic baseline')) return 'baseline';
    if (text.includes('当前真相与召回')) return 'memory';
    if (text.includes('上下文裁剪')) return 'advanced';
    if (text === '状态' || text.includes('诊断')) return 'diagnostics';
    return 'advanced';
}

function setActiveSettingsPage(pageId, { focus = false } = {}) {
    const shell = document.getElementById('aum-v55-settings-window');
    if (!shell) return false;
    const validPage = SETTINGS_PAGES.some(page => page.id === pageId) ? pageId : 'overview';
    shell.dataset.activePage = validPage;
    for (const page of SETTINGS_PAGES) {
        const panel = getSettingsPage(page.id);
        const tab = shell.querySelector(`[data-aum-page="${page.id}"]`);
        const active = page.id === validPage;
        if (panel) {
            panel.hidden = !active;
            panel.setAttribute('aria-hidden', String(!active));
        }
        if (tab) {
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            if (active && focus) tab.focus();
        }
    }
    try { globalThis.localStorage?.setItem(SETTINGS_PAGE_KEY, validPage); } catch { /* storage is optional */ }
    const viewport = shell.querySelector('.aum-v55-settings-viewport');
    if (viewport) viewport.scrollTop = 0;
    return true;
}

function installResponsiveLayout(shell) {
    if (!shell) return;
    const update = () => shell.classList.toggle('aum-v55-compact', shell.clientWidth < 560);
    update();
    if (typeof ResizeObserver !== 'function') return;
    layoutResizeObserver?.disconnect?.();
    layoutResizeObserver = new ResizeObserver(update);
    layoutResizeObserver.observe(shell);
}

function routeDynamicSections() {
    const content = getSettingsContent();
    if (!content) return false;
    const settings = getSettingsPage('settings');
    const binding = document.getElementById('aum-v55-chat-binding');
    const editor = document.getElementById('aum-v55-entry-editor');

    if (binding && settings && binding.parentElement !== settings) settings.prepend(binding);
    if (editor && settings && editor.parentElement !== settings) {
        if (binding?.parentElement === settings) binding.insertAdjacentElement('afterend', editor);
        else settings.prepend(editor);
    }
    return true;
}

function enhanceSettingsPagination() {
    if (typeof document === 'undefined') return false;
    const content = getSettingsContent();
    if (!content) return false;
    const existing = document.getElementById('aum-v55-settings-window');
    if (existing) {
        routeDynamicSections();
        installResponsiveLayout(existing);
        return true;
    }

    const originalChildren = [...content.children];
    const shell = document.createElement('div');
    shell.id = 'aum-v55-settings-window';
    shell.className = 'aum-v55-settings-window';

    const tabs = document.createElement('div');
    tabs.className = 'aum-v55-settings-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Aetheria 设置分页');

    const viewport = document.createElement('div');
    viewport.className = 'aum-v55-settings-viewport';

    const pages = new Map();
    for (const page of SETTINGS_PAGES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button aum-v55-settings-tab';
        button.dataset.aumPage = page.id;
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-controls', `aum-v55-settings-page-${page.id}`);
        button.innerHTML = `<i class="fa-solid ${page.icon}" aria-hidden="true"></i><span>${page.label}</span>`;
        button.addEventListener('click', () => setActiveSettingsPage(page.id));
        button.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const currentIndex = SETTINGS_PAGES.findIndex(row => row.id === page.id);
            let nextIndex = currentIndex;
            if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + SETTINGS_PAGES.length) % SETTINGS_PAGES.length;
            if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SETTINGS_PAGES.length;
            if (event.key === 'Home') nextIndex = 0;
            if (event.key === 'End') nextIndex = SETTINGS_PAGES.length - 1;
            setActiveSettingsPage(SETTINGS_PAGES[nextIndex].id, { focus: true });
        });
        tabs.append(button);

        const panel = document.createElement('section');
        panel.id = `aum-v55-settings-page-${page.id}`;
        panel.className = 'aum-v55-settings-page';
        panel.dataset.aumPage = page.id;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-label', page.label);
        panel.hidden = true;
        viewport.append(panel);
        pages.set(page.id, panel);
    }

    shell.append(tabs, viewport);
    content.append(shell);

    let currentPage = 'overview';
    for (const node of originalChildren) {
        if (node === shell) continue;
        if (node.id === 'aum-v55-chat-binding' || node.id === 'aum-v55-entry-editor') currentPage = 'settings';
        else if (node.tagName === 'H4') currentPage = classifyHeading(node.textContent) || currentPage;
        (pages.get(currentPage) || pages.get('advanced')).append(node);
    }

    const overview = pages.get('overview');
    if (overview && !overview.querySelector('.aum-v55-page-intro')) {
        const intro = document.createElement('div');
        intro.className = 'aum-v55-page-intro';
        intro.innerHTML = '<b>设置已分页</b><span>常用操作按“记忆 / 设定 / 基线 / 高级 / 诊断”拆分。窗口内部独立滚动，不再把扩展页无限拉长。</span>';
        overview.prepend(intro);
    }

    routeDynamicSections();
    installResponsiveLayout(shell);
    let remembered = 'overview';
    try { remembered = globalThis.localStorage?.getItem(SETTINGS_PAGE_KEY) || 'overview'; } catch { /* storage is optional */ }
    setActiveSettingsPage(remembered);
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

    if (document.getElementById('aum-v55-settings-window')) routeDynamicSections();
    else {
        const binding = document.getElementById('aum-v55-chat-binding');
        const editor = document.getElementById('aum-v55-entry-editor');
        if (binding && binding.parentElement !== content) content.prepend(binding);
        if (editor && editor.parentElement !== content) {
            if (binding?.parentElement === content) binding.insertAdjacentElement('afterend', editor);
            else content.prepend(editor);
        }
    }
    return true;
}

function refreshV55Ui() {
    enhanceSettingsPagination();
    normalizeSettingsUi();
    mountNarrativeSettings(getContext, createNarrativeHostServices);
}

function scheduleUiNormalization() {
    for (const delay of [0, 250, 900, 1300, 1800, 2600]) {
        setTimeout(refreshV55Ui, delay);
    }
}

function installDashboardEvents(ctx) {
    if (dashboardEventsInstalled || !ctx?.eventSource?.on) return false;
    const events = ctx.eventTypes || {};
    const schedule = () => setTimeout(refreshV55Ui, 60);
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
    if (!ctx) return false;

    // One install. This used to require globalThis[aetheriaUnifiedMemoryV54Interceptor] to exist, which
    // only proved the legacy core had loaded; the narrative runtime is the entry now.
    installNarrativeRuntime(getContext, createNarrativeHostServices);
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
