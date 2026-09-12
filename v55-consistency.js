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
    injectSceneEvidenceBlock,
    injectSceneSummaryBlock,
    selectSceneSummaries,
} from './v55-finalizer.js';
import { sanitizeStoreForActor } from './v55-privacy.js';
import { getMandatoryMemories, isDialogueRow } from './memory-core.js';
import { persistChatStore } from './v55-derived-store.js';
import { getHierarchicalSummaryContext, SUMMARY_PROMPT_KEY } from './v55-summary-runtime.js';
import { stabilizeProvenanceStore } from './v55-provenance.js';
import { formatEvidenceBlock, resolveMemoryLookupRequests, resolveTurnEvidence } from './v55-evidence.js';
import { REFERENCE_HEADER_CHARS } from './context-assembler.js';
// A8 computed where the injected text actually exists. The published bundle is deleted a few lines
// below, so an external reader can never measure what reached the prompt; the plugin has to measure
// itself, at the one moment it can.
import { buildCausalProbes, scoreCausalProbes } from './v55-quality-metrics.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

function clean(value, max = 10_000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function latestQuery(chatInput) {
    return (Array.isArray(chatInput) ? chatInput : [])
        .filter(row => isDialogueRow(row))
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

// This used to set SUMMARY_PROMPT_KEY to the empty string on every generation, to clear a standalone
// summary prompt that no longer exists: the summary has ridden inside the reference block since
// injectSceneSummaryBlock was introduced, and this key has been written with nothing but '' for its whole
// life. Clearing it that way turned out to be the opposite of harmless.
//
// The host validates the projection it builds from the prompt surface and refuses more than TWO ranges.
// An extension prompt registered with an empty value still counts as a range, so this "clear" was the
// third one, and every generation threw "ChatSurface projection has 3 ranges; maximum is 2". Measured on
// a 20-turn run: 9 of 10 replies were lost to it, and the failure is inside generate(), so it looks like
// the model hanging rather than like a plugin bug - the UI just sits on "thinking".
//
// The rule this leaves behind: never register a prompt key you do not intend to fill. If a legacy value
// ever needs clearing, it has to be cleared once at install time, not on every generation.
function clearStandaloneSummary() {
    return false;
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

    // The layered summary rides inside the reference block, so the reference cap truncates it - and
    // `truncate` keeps the head, which is the OLDEST narration. On the 50-floor acceptance chat the tree
    // was 3,697 characters against roughly 3,500 of room, so the newest floors were being cut mid-
    // sentence while the oldest were kept. Handing the summary a share of the reference cap lets its own
    // formatter trim instead, and that one keeps the tail: the same characters, the recent end of them.
    // The share is large because the summary is the only carrier left for folded floors (the raw prompt
    // holds 402 tokens of transcript), while the recalled-memory rows below it restate memories the
    // current-state block now renders in full.
    const referenceRoom = Math.max(0, Number(settings.reference_context_max_chars) || 0);
    const summaryMaxChars = Math.min(
        Math.max(0, Number(settings.summary_max_context_chars) || 0),
        Math.max(600, referenceRoom - REFERENCE_HEADER_CHARS),
    );
    const hierarchicalBlock = getHierarchicalSummaryContext(ctx, { actor, store, maxChars: summaryMaxChars });
    const summaryVisibility = store.hierarchical_summaries?.visibility_debug || {};
    // Original text reaches the prompt by two routes, and until now only the first existed.
    //
    //   1. On demand, when the previous assistant turn emitted 【查阅记忆】. Kept, but it cannot be the
    //      only route: the model writes that marker only when it already suspects it has forgotten
    //      something, which is exactly the case it cannot detect. A retrieval path whose trigger is the
    //      model choosing to speak is the failure mode this project was warned about.
    //   2. Computed, from the turn itself (memory_evidence_auto). No model decision, no veto, and it runs
    //      every turn - generous by construction, because a missed retrieval is unrecoverable within the
    //      turn while a spurious one costs characters.
    //
    // Both resolve through the same evidence resolver, so the original-text guarantee is one mechanism
    // with two triggers rather than two mechanisms that can drift.
    const rows = Array.isArray(ctx.chat) ? ctx.chat : [];
    const visibleText = String(visibleCanonical.referenceBlock || '') + '\n' + String(visibleCanonical.currentStateBlock || '');
    const evidenceBlock = settings.memory_evidence_enabled === false ? '' : (() => {
        const lastAssistant = [...rows].reverse().find(row => row && !row.is_user && isDialogueRow(row));
        const asked = lastAssistant
            ? resolveMemoryLookupRequests(store, rows, String(lastAssistant.mes || ''), {
                maxChars: settings.memory_evidence_max_chars,
            })
            : { entries: [] };
        const computed = settings.memory_evidence_auto === false
            ? { entries: [], abstained: false, unmatched: [] }
            : resolveTurnEvidence(store, rows, {
                maxEntries: settings.memory_evidence_auto_entries ?? 3,
                maxChars: settings.memory_evidence_max_chars,
                alreadyVisible: visibleText,
                protectRecent: settings.protect_recent_messages,
            });
        // One source turn is one piece of evidence: if both triggers found the same floor, send it once.
        const seen = new Set();
        const merged = [];
        for (const entry of [...asked.entries, ...computed.entries]) {
            const id = entry.source + '|' + String(entry.turns?.[0]?.index ?? '');
            if (seen.has(id)) continue;
            seen.add(id);
            merged.push(entry);
        }
        store.last_evidence_sources = {
            asked: asked.entries.length,
            computed: computed.entries.length,
            merged: merged.length,
            considered: computed.considered ?? 0,
            abstained: computed.abstained === true,
            unmatched: computed.unmatched || [],
            at: Date.now(),
        };
        return formatEvidenceBlock(merged, {
            maxChars: settings.memory_evidence_max_chars,
            abstained: computed.abstained === true,
            unmatched: computed.unmatched || [],
            // The reference and state blocks are what the model is about to read. A retrieved line that is
            // already inside them is a duplicate, not evidence.
            alreadyVisible: visibleText,
        });
    })();
    // The scene-locator block is deliberately NOT injected. It calls itself "derived, rebuildable, not a
    // source of new facts" and exists to point at history, but 66% of its characters were measured to be
    // verbatim substrings of the layered summary above (24-character n-gram containment over the live
    // 50-floor chat, 242 of 369 probes), and it was spending 2,297 of the 4,000 reference characters to
    // do it. That was already the whole block being cut by the cap whenever the summary was funded;
    // funding the summary shrank it instead, which traded the ONLY multi-level recap of folded floors
    // for a duplicated locator list. The scenes are still built and still feed the evidence channel.
    let referenceWithDerived = injectSceneSummaryBlock(visibleCanonical.referenceBlock, hierarchicalBlock);
    referenceWithDerived = injectSceneEvidenceBlock(
        referenceWithDerived,
        collectSceneEvidence(sanitized.store, selectedScenes, { maxChars: 1200 }),
    );

    // The evidence block is appended ONCE, after budgeting, at the bottom of this function. It used to be
    // appended here as well, which put every evidence line in the prompt twice - measured live as a
    // 368-character abstention banner repeated verbatim on turn 1 of a fresh chat. The pre-budget copy also
    // meant the reservation below was paying for text that was already inside the string it was reserving
    // against, so the duplicate cost the reference block its own budget twice over.
    store.last_evidence_resolution = { chars: evidenceBlock.length, at: Date.now() };

    // The evidence is appended after the derived blocks, so without a reservation the reference trim below
    // removes it first - the same failure the change chain had before it was reserved. Measured on the
    // live 51-floor chat: a 3-entry, 1,733-character evidence block was resolved, recorded in
    // last_evidence_sources as injected, and then silently cut, because the 4,000-character reference cap
    // was already spent by the summary and the imported setting text. A path that measures as working and
    // delivers nothing is worse than one that is absent, because nothing reports the difference.
    const bounded = budgetPromptPair(referenceWithDerived, visibleCanonical.currentStateBlock, {
        contextSize: args?.[1],
        replyReserve: settings.context_reply_reserve_tokens,
        maxReferenceChars: Math.max(0, (Number(settings.reference_context_max_chars) || 0)
            - (evidenceBlock ? evidenceBlock.length + 2 : 0)),
        maxCurrentStateChars: settings.current_state_context_max_chars,
    });
    if (evidenceBlock) {
        bounded.referenceBlock = bounded.referenceBlock
            ? bounded.referenceBlock + '\n\n' + evidenceBlock
            : evidenceBlock;
        bounded.diagnostics.evidence_chars = evidenceBlock.length;
    }

    realSetPrompt(reference.key, bounded.referenceBlock, ...promptArgs(reference.rest, 4));
    realSetPrompt(current.key, bounded.currentStateBlock, ...promptArgs(current.rest, 1));
    // S4 self-check: which irreversible memories this turn was supposed to carry, and which of them
    // actually appear in the block that reaches the model. A guarantee nobody can observe is not a
    // guarantee, and this is what the S7 control experiment reads.
    const mandatory = getMandatoryMemories(store, 24);
    const currentStateText = String(visibleCanonical.currentStateBlock || '');
    const injectedMandatoryIds = mandatory
        .filter(memory => memory.text && currentStateText.includes(String(memory.text)))
        .map(memory => memory.id);
    // The deterministic half of A8, evaluated against the exact text that is about to be published.
    // Bounded: at most 16 probes, and only the scores are kept, never the probe texts.
    let causal = { total: 0, hit: null, rate: null };
    try {
        const probes = buildCausalProbes(store, { limit: 16 });
        const injectedText = String(bounded.referenceBlock || '') + '\n\n' + currentStateText;
        causal = scoreCausalProbes(store, probes, { scope: 'injected', injectedText, available: true });
    } catch (error) {
        causal = { total: 0, hit: null, rate: null, error: String(error?.message || error).slice(0, 120) };
    }
    store.v55_consistency = {
        mandatory_memory_ids: mandatory.map(memory => memory.id),
        injected_mandatory_ids: injectedMandatoryIds,
        key_retention: {
            total: mandatory.length,
            kept: injectedMandatoryIds.length,
            rate: mandatory.length ? injectedMandatoryIds.length / mandatory.length : 1,
        },
        // Injection coverage over every slot the store owns, NOT a correctness guarantee: a turn only
        // injects the mandatory set plus a retrieval-selected subset, so this number is structurally
        // well below 1 on a long chat and is an A5 budget input. The guarantee is key_retention above.
        injection_coverage: { total: causal.total, hit: causal.hit, rate: causal.rate },
        hidden_private_memory_ids: visibleCanonical.hiddenMemoryIds,
        hidden_extraction_source_keys: sanitized.hiddenSourceKeys,
        hidden_extraction_operation_count: sanitized.hiddenOperationCount,
        hidden_hierarchical_summary_ids: summaryVisibility.hidden_summary_ids || [],
        selected_scene_ids: selectedScenes.map(scene => scene.scene_id),
        scene_count: scenes.length,
        generation_type: lifecycle.generationType || 'normal',
        summary_in_reference_chars: hierarchicalBlock.length,
        // The published bundle lives in the derived record and is gone after a chat reload, so the
        // sizes of what actually reached the prompt are recorded here, where they survive.
        injected_reference_chars: String(bounded.referenceBlock || '').length,
        injected_current_state_chars: currentStateText.length,
        ...bounded.diagnostics,
        at: Date.now(),
    };
    // v55_consistency and v55_finalizer_diagnostics are derived; the projection keeps them out of the
    // chat file and ships them to the derived store.
    persistChatStore(ctx);
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
