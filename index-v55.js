// v5.5 iteration08 staged entry point.
// Load the proven v5.4/v5.5-A..G runtime, then layer the v5.5 hardening/finalizer
// boundaries without rewriting the mature legacy entry point.
import { init as legacyInit } from './index.js';
import { installV55Runtime } from './v55-runtime.js';
import { installV55Finalizer } from './v55-finalizer.js';
import { installV55Consistency } from './v55-consistency.js';
import { installV55Provenance } from './v55-provenance.js';

const INTERCEPTOR_NAME = 'aetheriaUnifiedMemoryV54Interceptor';
const LEGACY_EXTENSION_PATH = 'third-party/aetheria-unified-memory-v5_4';

function resolveRuntimeExtensionPath() {
    try {
        const pathname = new URL(import.meta.url, globalThis.location?.href || undefined).pathname;
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

function normalizeSettingsUi() {
    const root = document.getElementById('aum-v54-settings');
    if (!root) return false;
    const content = root.querySelector(':scope > .inline-drawer-content') || root.querySelector('.inline-drawer-content');
    if (!content) return false;

    const header = root.querySelector(':scope > .inline-drawer-toggle.inline-drawer-header') || root.querySelector('.inline-drawer-toggle.inline-drawer-header');
    if (header && !header.querySelector('.aum-v55-brand-icon')) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-brain aum-v55-brand-icon';
        icon.title = 'Aetheria Unified Memory';
        icon.setAttribute('aria-hidden', 'true');
        header.prepend(icon);
    }

    const binding = document.getElementById('aum-v55-chat-binding');
    if (binding && binding.parentElement !== content) content.prepend(binding);

    const editor = document.getElementById('aum-v55-entry-editor');
    if (editor && editor.parentElement !== content) {
        if (binding?.parentElement === content) binding.insertAdjacentElement('afterend', editor);
        else content.prepend(editor);
    }
    return true;
}

function scheduleUiNormalization() {
    for (const delay of [0, 250, 900, 1300, 1800, 2600]) {
        setTimeout(() => normalizeSettingsUi(), delay);
    }
}

function installAll() {
    installContextCompatibility();
    if (stackInstalled) {
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
