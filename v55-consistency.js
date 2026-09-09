// Aetheria Unified Memory v5.5 — post-runtime consistency pass.
// Re-acquires chat metadata after the compatibility runtime has normalized/replayed
// it, then performs the final v5.5 prompt transformation against the current object.

import { budgetPromptPair, ensureChatSettingBinding, stampRuntimeIdentity } from './v55-runtime.js';
import {
    buildSceneSummaries,
    collectSceneEvidence,
    filterPrivateKnowledge,
    formatSceneSummaryBlock,
    injectSceneEvidenceBlock,
    injectSceneSummaryBlock,
    selectSceneSummaries,
} from './v55-finalizer.js';
import { stabilizeProvenanceStore } from './v55-provenance.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';

function clean(value, max = 10_000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function unique(values) {
    return [...new Set((Array.isArray(values) ? values : []).map(x => clean(x, 300)).filter(Boolean))];
}

function actorIdentity(ctx, store) {
    const aliases = unique([
        ctx?.name2,
        ctx?.character?.name,
        ctx?.characters?.[ctx?.characterId]?.name,
    ]).map(x => x.normalize('NFKC').toLocaleLowerCase());
    const ids = [];
    const discriminator = ctx?.characterId !== undefined && ctx?.characterId !== null ? `st-character:${ctx.characterId}` : null;
    for (const row of Object.values(store?.entity_registry || {})) {
        if (!row?.entity_id) continue;
        if (discriminator && row.discriminator === discriminator) ids.push(row.entity_id);
        else if (!discriminator && (row.aliases || []).some(alias => aliases.includes(clean(alias, 300).normalize('NFKC').toLocaleLowerCase()))) ids.push(row.entity_id);
    }
    return { aliases, ids: unique(ids) };
}

function latestQuery(chatInput) {
    return (Array.isArray(chatInput) ? chatInput : [])
        .filter(row => row && !row.is_system)
        .slice(-3)
        .map(row => clean(row.mes, 5000))
        .filter(Boolean)
        .join('\n');
}

export async function runWithV55Consistency(ctx, innerInterceptor, args) {
    if (!ctx || typeof innerInterceptor !== 'function') return;
    const settings = ctx.extensionSettings?.[SETTINGS_KEY];
    if (!settings) return innerInterceptor(...args);

    const realSetPrompt = typeof ctx.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : null;
    if (!realSetPrompt) return innerInterceptor(...args);
    const captured = new Map();
    ctx.setExtensionPrompt = (key, value, ...rest) => {
        if (key === REFERENCE_PROMPT_KEY || key === CURRENT_STATE_PROMPT_KEY) {
            captured.set(key, { key, value: String(value ?? ''), rest });
            return;
        }
        return realSetPrompt(key, value, ...rest);
    };
    try {
        await innerInterceptor(...args);
    } finally {
        ctx.setExtensionPrompt = realSetPrompt;
    }

    const store = ctx.chatMetadata?.[METADATA_KEY];
    if (!store || !captured.size) {
        for (const row of captured.values()) realSetPrompt(row.key, row.value, ...row.rest);
        return;
    }
    ensureChatSettingBinding(ctx);
    // Provenance must observe the pre-stamp branch ownership first: stampRuntimeIdentity()
    // unconditionally rewrites record.branch_id, so stabilizing afterwards would record the
    // freshly derived branch as the origin and lose the first-observed origin (I07 defect).
    stabilizeProvenanceStore(store, store.runtime_identity?.branch_id);
    stampRuntimeIdentity(ctx);

    const reference = captured.get(REFERENCE_PROMPT_KEY) || { key: REFERENCE_PROMPT_KEY, value: '', rest: [] };
    const current = captured.get(CURRENT_STATE_PROMPT_KEY) || { key: CURRENT_STATE_PROMPT_KEY, value: '', rest: [] };
    // Suppressed generations (plugin disabled / quiet / impersonate) must stay cleared. The
    // legacy interceptor already emitted empty payloads; without this guard the scene-summary
    // pass below would refill the Reference key (I07 defect).
    const generationType = String(args?.[3] || '').toLowerCase();
    const pluginOwnedQuiet = settings.__quiet_extraction_in_progress === true;
    const thirdPartyQuietInjection = settings.quiet_allow_third_party_injection === true && !pluginOwnedQuiet;
    const suppressed = settings.enabled === false
        || generationType === 'impersonate'
        || (generationType === 'quiet' && !thirdPartyQuietInjection);
    if (suppressed) {
        realSetPrompt(reference.key, '', ...reference.rest);
        realSetPrompt(current.key, '', ...current.rest);
        return;
    }

    const scenes = buildSceneSummaries(store);
    store.scene_summaries = scenes;
    store.scene_summary_source = 'extraction-transactions-only';
    const selectedScenes = selectSceneSummaries(scenes, latestQuery(args?.[0] || ctx.chat || []), { limit: 3 });

    const visible = filterPrivateKnowledge(reference.value, current.value, store, actorIdentity(ctx, store));
    const withScenes = injectSceneSummaryBlock(visible.referenceBlock, formatSceneSummaryBlock(selectedScenes));
    const withEvidence = injectSceneEvidenceBlock(withScenes, collectSceneEvidence(store, selectedScenes, { maxChars: 1200 }));
    const bounded = budgetPromptPair(withEvidence, visible.currentStateBlock, {
        contextSize: args?.[1],
        replyReserve: settings.context_reply_reserve_tokens,
        maxReferenceChars: settings.reference_context_max_chars,
        maxCurrentStateChars: settings.current_state_context_max_chars,
    });

    realSetPrompt(reference.key, bounded.referenceBlock, ...reference.rest);
    realSetPrompt(current.key, bounded.currentStateBlock, ...current.rest);
    store.v55_consistency = {
        hidden_private_memory_ids: visible.hiddenMemoryIds,
        selected_scene_ids: selectedScenes.map(scene => scene.scene_id),
        scene_count: scenes.length,
        ...bounded.diagnostics,
        at: Date.now(),
    };
    ctx.saveMetadataDebounced?.();
}

export function installV55Consistency(getContext, interceptorName) {
    const ctx = getContext?.();
    if (!ctx) return false;
    const inner = globalThis[interceptorName];
    if (typeof inner !== 'function' || inner.__v55Consistent) return false;
    const wrapped = async (...args) => runWithV55Consistency(getContext?.() || ctx, inner, args);
    wrapped.__v55Consistent = true;
    wrapped.__inner = inner;
    globalThis[interceptorName] = wrapped;
    return true;
}
