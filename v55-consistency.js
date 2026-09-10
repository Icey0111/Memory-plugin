// Aetheria Unified Memory v5.5 — post-runtime consistency pass.
// Every generated Aetheria context channel is finalized here so privacy, generation lifecycle,
// and the shared prompt budget are applied once, after the legacy runtime has normalized state.

import {
    budgetPromptPair,
    deriveActorIdentity,
    ensureChatSettingBinding,
    stampRuntimeIdentity,
} from './v55-runtime.js';
import {
    buildSceneSummaries,
    collectSceneEvidence,
    filterPrivateKnowledge,
    formatSceneSummaryBlock,
    injectSceneEvidenceBlock,
    injectSceneSummaryBlock,
    selectSceneSummaries,
} from './v55-finalizer.js';
import { sanitizeStoreForActor } from './v55-privacy.js';
import { getHierarchicalSummaryContext, normalizeSummaryInjectionDepth } from './v55-summary-runtime.js';
import { stabilizeProvenanceStore } from './v55-provenance.js';
import { formatEvidenceBlock, resolveMemoryLookupRequests } from './v55-evidence.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';
const SUMMARY_PROMPT_KEY = 'aetheria_unified_memory_v5_5_hierarchical_summary';
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

function clean(value, max = 10_000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function latestQuery(chatInput) {
    return (Array.isArray(chatInput) ? chatInput : [])
        .filter(row => row && !row.is_system)
        .slice(-3)
        .map(row => clean(row.mes, 5000))
        .filter(Boolean)
        .join('\n');
}

// SillyTavern matches an extension prompt's position against its own extension_prompt_types and
// silently skips anything else. `Number(undefined)` is NaN, so re-emitting a captured row whose
// position was never captured erased the block from the request with no error anywhere.
function promptArgs(rest, fallbackDepth) {
    const position = Number(rest?.[0]);
    const depth = Number(rest?.[1]);
    return [
        Number.isFinite(position) ? position : IN_CHAT,
        Number.isFinite(depth) ? depth : fallbackDepth,
        rest?.[2] ?? false,
        rest?.[3] ?? SYSTEM_ROLE,
    ];
}

// The legacy runtime publishes what it injected so this pass can compose on top of it without
// swapping ctx.setExtensionPrompt, which does not work when getContext() hands out a fresh object.
function captureOrPublished(captured, published, key) {
    const capturedRow = captured.get(key);
    if (capturedRow) return capturedRow;
    if (!published || typeof published !== 'object') return { key, value: '', rest: [] };
    const isReference = key === REFERENCE_PROMPT_KEY;
    return {
        key,
        value: String((isReference ? published.reference_block : published.current_state_block) || ''),
        rest: [
            isReference ? published.reference_position : published.current_state_position,
            isReference ? published.reference_depth : published.current_state_depth,
            false,
            SYSTEM_ROLE,
        ],
    };
}

function clearStandaloneSummary(realSetPrompt, settings) {
    const depth = normalizeSummaryInjectionDepth(settings?.summary_injection_depth, 4);
    realSetPrompt(SUMMARY_PROMPT_KEY, '', IN_CHAT, depth, false, SYSTEM_ROLE);
}

function generationSuppressed(settings, args) {
    const generationType = String(args?.[3] || '').toLowerCase();
    const pluginOwnedQuiet = settings.__quiet_extraction_in_progress === true
        || settings.__hierarchical_summary_in_progress === true;
    const thirdPartyQuietInjection = settings.quiet_allow_third_party_injection === true && !pluginOwnedQuiet;
    return {
        generationType,
        pluginOwnedQuiet,
        suppressed: settings.enabled === false
            || generationType === 'impersonate'
            || (generationType === 'quiet' && !thirdPartyQuietInjection),
    };
}

let generationChain = Promise.resolve();

export async function runWithV55Consistency(ctx, innerInterceptor, args) {
    // Every layer swaps the shared ctx.setExtensionPrompt across an await, so two overlapping
    // generations would capture each other's prompt writes. Serialize the whole chain.
    const run = generationChain.then(
        () => runWithV55ConsistencyInner(ctx, innerInterceptor, args),
        () => runWithV55ConsistencyInner(ctx, innerInterceptor, args),
    );
    generationChain = run.then(() => undefined, () => undefined);
    return run;
}

async function runWithV55ConsistencyInner(ctx, innerInterceptor, args) {
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
        if (key === SUMMARY_PROMPT_KEY) {
            captured.set(key, { key, value: '', rest });
            return;
        }
        return realSetPrompt(key, value, ...rest);
    };
    try {
        await innerInterceptor(...args);
    } finally {
        ctx.setExtensionPrompt = realSetPrompt;
    }

    const published = ctx.chatMetadata?.[METADATA_KEY]?.v55_inner_bundle || null;
    const reference = captureOrPublished(captured, published, REFERENCE_PROMPT_KEY);
    const current = captureOrPublished(captured, published, CURRENT_STATE_PROMPT_KEY);
    // Scratch value for this one generation; it must not accumulate in chat metadata.
    if (published && ctx.chatMetadata?.[METADATA_KEY]) delete ctx.chatMetadata[METADATA_KEY].v55_inner_bundle;
    clearStandaloneSummary(realSetPrompt, settings);

    const store = ctx.chatMetadata?.[METADATA_KEY];
    if (!store) {
        realSetPrompt(reference.key, reference.value, ...promptArgs(reference.rest, 4));
        realSetPrompt(current.key, current.value, ...promptArgs(current.rest, 1));
        return;
    }

    const lifecycle = generationSuppressed(settings, args);
    if (lifecycle.suppressed) {
        realSetPrompt(reference.key, '', ...promptArgs(reference.rest, 4));
        realSetPrompt(current.key, '', ...promptArgs(current.rest, 1));
        return;
    }

    ensureChatSettingBinding(ctx);
    stabilizeProvenanceStore(store, store.runtime_identity?.branch_id);
    stampRuntimeIdentity(ctx);

    const actor = deriveActorIdentity(ctx, store);
    const visibleCanonical = filterPrivateKnowledge(reference.value, current.value, store, actor);
    const sanitized = sanitizeStoreForActor(store, actor);
    const scenes = buildSceneSummaries(sanitized.store);
    store.scene_summaries = scenes;
    store.scene_summary_source = 'visibility-filtered-extraction-transactions';
    const selectedScenes = selectSceneSummaries(scenes, latestQuery(args?.[0] || ctx.chat || []), { limit: 3 });

    const hierarchicalBlock = getHierarchicalSummaryContext(ctx, { actor, store, maxChars: settings.summary_max_context_chars });
    const summaryVisibility = store.hierarchical_summaries?.visibility_debug || {};
    // On-demand backlink: if the previous assistant turn emitted a 【查阅记忆】 block, resolve it
    // against the live chat first and the cold snapshot second, and add bounded原文 evidence.
    const evidenceBlock = settings.memory_evidence_enabled === false ? '' : (() => {
        const rows = Array.isArray(ctx.chat) ? ctx.chat : [];
        const lastAssistant = [...rows].reverse().find(row => row && !row.is_user && !row.is_system);
        if (!lastAssistant) return '';
        const resolved = resolveMemoryLookupRequests(store, rows, String(lastAssistant.mes || ''), {
            maxChars: settings.memory_evidence_max_chars,
        });
        return formatEvidenceBlock(resolved.entries, { maxChars: settings.memory_evidence_max_chars });
    })();
    let referenceWithDerived = injectSceneSummaryBlock(visibleCanonical.referenceBlock, hierarchicalBlock);
    referenceWithDerived = injectSceneSummaryBlock(referenceWithDerived, formatSceneSummaryBlock(selectedScenes));
    referenceWithDerived = injectSceneEvidenceBlock(
        referenceWithDerived,
        collectSceneEvidence(sanitized.store, selectedScenes, { maxChars: 1200 }),
    );

    if (evidenceBlock) referenceWithDerived = `${referenceWithDerived}\n\n${evidenceBlock}`;
    store.last_evidence_resolution = { chars: evidenceBlock.length, at: Date.now() };

    const bounded = budgetPromptPair(referenceWithDerived, visibleCanonical.currentStateBlock, {
        contextSize: args?.[1],
        replyReserve: settings.context_reply_reserve_tokens,
        maxReferenceChars: settings.reference_context_max_chars,
        maxCurrentStateChars: settings.current_state_context_max_chars,
    });

    realSetPrompt(reference.key, bounded.referenceBlock, ...promptArgs(reference.rest, 4));
    realSetPrompt(current.key, bounded.currentStateBlock, ...promptArgs(current.rest, 1));
    store.v55_consistency = {
        hidden_private_memory_ids: visibleCanonical.hiddenMemoryIds,
        hidden_extraction_source_keys: sanitized.hiddenSourceKeys,
        hidden_extraction_operation_count: sanitized.hiddenOperationCount,
        hidden_hierarchical_summary_ids: summaryVisibility.hidden_summary_ids || [],
        selected_scene_ids: selectedScenes.map(scene => scene.scene_id),
        scene_count: scenes.length,
        generation_type: lifecycle.generationType || 'normal',
        summary_in_reference_chars: hierarchicalBlock.length,
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
