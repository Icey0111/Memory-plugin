// Aetheria Unified Memory v5.5 — iteration07 finalizer.
//
// This layer deliberately sits outside the mature v5.4/v5.5-A..G runtime. It
// completes the architectural boundaries that need chat-aware host context:
// - immutable imported revisions + editable per-entry overlays;
// - derived/rebuildable scene-summary locators;
// - role-knowledge filtering for private plot memories;
// - final combined prompt-budget enforcement after scene insertion;
// - untitled TXT segmentation preview without silently changing import semantics.

import {
    budgetPromptPair,
    ensureChatSettingBinding,
    fnv1a32Runtime,
    stampRuntimeIdentity,
} from './v55-runtime.js';
import { isDialogueRow } from './memory-core.js';

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const REFERENCE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_reference';
const CURRENT_STATE_PROMPT_KEY = 'aetheria_unified_memory_v5_4_current_state';

function clean(value, max = 100_000) {
    return String(value ?? '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, Math.max(0, Number(max) || 0));
}

function unique(values, max = 100) {
    const out = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const text = clean(value, 300);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push(text);
        if (out.length >= max) break;
    }
    return out;
}

function clone(value) {
    if (globalThis.structuredClone) return globalThis.structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getSettingsRoot(ctx) {
    return ctx?.extensionSettings?.[SETTINGS_KEY] || null;
}

function getChatStore(ctx) {
    return ctx?.chatMetadata?.[METADATA_KEY] || null;
}

export function settingOverrideKey(worldId, revisionId, entryId) {
    return `${clean(worldId, 160)}::${clean(revisionId, 160)}::${clean(entryId, 160)}`;
}

export function normalizeSettingOverride(input) {
    const row = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const normalizeKeys = value => unique(Array.isArray(value) ? value : String(value ?? '').split(/[\n,，]+/u), 50);
    return {
        title: row.title === undefined ? undefined : (clean(row.title, 800) || null),
        comment: row.comment === undefined ? undefined : (clean(row.comment, 800) || null),
        content: row.content === undefined ? undefined : clean(row.content, 200_000),
        keys: row.keys === undefined ? undefined : normalizeKeys(row.keys),
        secondary_keys: row.secondary_keys === undefined ? undefined : normalizeKeys(row.secondary_keys),
        constant: row.constant === undefined ? undefined : Boolean(row.constant),
        disabled: row.disabled === undefined ? undefined : Boolean(row.disabled),
        order: row.order === undefined ? undefined : (Number.isFinite(Number(row.order)) ? Number(row.order) : null),
        updated_at: Number.isFinite(Number(row.updated_at)) ? Number(row.updated_at) : Date.now(),
        base_content_hash: clean(row.base_content_hash, 300) || null,
    };
}

export function applySettingOverrides(storeInput, overridesInput, bindingInput = null) {
    const store = storeInput && typeof storeInput === 'object' ? clone(storeInput) : storeInput;
    if (!store || typeof store !== 'object') return { store: storeInput, applied: [], ignored: [] };
    const overrides = overridesInput && typeof overridesInput === 'object' && !Array.isArray(overridesInput) ? overridesInput : {};
    const binding = bindingInput && typeof bindingInput === 'object' ? bindingInput : null;
    const allowedRevisions = binding
        ? new Set([binding.baseline_revision_id, ...(binding.extension_revision_ids || [])].filter(Boolean).map(String))
        : null;
    const applied = [];
    const ignored = [];

    for (const [key, rawPatch] of Object.entries(overrides)) {
        const parts = key.split('::');
        if (parts.length !== 3) {
            ignored.push({ key, reason: 'invalid-key' });
            continue;
        }
        const [worldId, revisionId, entryId] = parts;
        if (binding?.world_id && worldId !== binding.world_id) continue;
        if (allowedRevisions && !allowedRevisions.has(revisionId)) continue;
        const entry = store.entries?.[entryId];
        if (!entry || entry.world_id !== worldId || entry.revision_id !== revisionId) {
            ignored.push({ key, reason: 'entry-not-found-or-scope-mismatch' });
            continue;
        }
        const patch = normalizeSettingOverride(rawPatch);
        for (const field of ['title', 'comment', 'content', 'keys', 'secondary_keys', 'constant', 'disabled', 'order']) {
            if (patch[field] !== undefined) entry[field] = clone(patch[field]);
        }
        const signatureSeed = JSON.stringify({
            entry_id: entry.entry_id,
            title: entry.title,
            comment: entry.comment,
            content: entry.content,
            keys: entry.keys,
            secondary_keys: entry.secondary_keys,
            constant: entry.constant,
            disabled: entry.disabled,
            order: entry.order,
        });
        entry.content_hash = `override_${fnv1a32Runtime(signatureSeed).toString(36)}`;
        entry.raw_extra = {
            ...(entry.raw_extra || {}),
            v55_override: {
                key,
                updated_at: patch.updated_at,
                base_content_hash: patch.base_content_hash,
            },
        };
        applied.push(entryId);
    }
    return { store, applied: unique(applied, 5000), ignored };
}

function operationEntities(record) {
    const out = [];
    for (const op of Array.isArray(record?.operations) ? record.operations : []) {
        out.push(...(Array.isArray(op?.entities) ? op.entities : []));
        out.push(...(Array.isArray(op?.known_by) ? op.known_by : []));
    }
    return unique(out, 30);
}

function operationLocation(record) {
    const ops = Array.isArray(record?.operations) ? record.operations : [];
    for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i] || {};
        const slot = clean(op.slot || op.target_slot, 300).toLowerCase();
        if (/(^|\.)(location|place|position)(\.|$)/i.test(slot) && clean(op.text, 1000)) return clean(op.text, 1000);
    }
    return '';
}

function operationOpenItems(record) {
    const out = [];
    for (const op of Array.isArray(record?.operations) ? record.operations : []) {
        if (op?.op === 'add' && ['commitment', 'intention'].includes(op.kind) && clean(op.text, 1000)) out.push(clean(op.text, 1000));
    }
    return unique(out, 12);
}

function extractionRows(storeInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    return Object.entries(store.extractions || {})
        .map(([sourceKey, record]) => ({ sourceKey, record }))
        .filter(row => row.record && clean(row.record.event_summary, 5000))
        .sort((a, b) => Number(a.record.assistant_index_at_creation ?? a.record.source_message ?? 0)
            - Number(b.record.assistant_index_at_creation ?? b.record.source_message ?? 0));
}

export function buildSceneSummaries(storeInput, {
    maxTransactionsPerScene = 6,
    maxSummaryChars = 1400,
} = {}) {
    const rows = extractionRows(storeInput);
    const scenes = [];
    let current = null;
    const flush = () => {
        if (!current?.transactions?.length) return;
        const txIds = current.transactions.map(row => row.transaction_id);
        const seed = txIds.join('|');
        const summaries = current.transactions.map(row => row.event_summary).filter(Boolean);
        const text = clean(summaries.join(' → '), maxSummaryChars);
        scenes.push({
            scene_id: `scene_${fnv1a32Runtime(seed).toString(36)}`,
            world_id: current.world_id || null,
            chat_id: current.chat_id || null,
            branch_id: current.branch_id || null,
            source_transaction_ids: txIds,
            source_keys: current.transactions.map(row => row.source_key),
            start_message: current.start_message,
            end_message: current.end_message,
            location: current.location || null,
            actors: unique(current.actors, 40),
            outcome: text,
            open_items: unique(current.open_items, 20),
            fingerprint: `scf_${fnv1a32Runtime(`${seed}|${text}`).toString(36)}`,
        });
        current = null;
    };

    for (const { sourceKey, record } of rows) {
        const location = operationLocation(record);
        const messageIndex = Number(record.assistant_index_at_creation ?? record.source_message ?? 0);
        const txId = clean(record.transaction_id, 300)
            || `tx_${fnv1a32Runtime(`${record.chat_id || ''}|${record.branch_id || ''}|${sourceKey}|${record.source_hash ?? ''}`).toString(36)}`;
        const needsBoundary = current && (
            current.transactions.length >= Math.max(1, Number(maxTransactionsPerScene) || 6)
            || (location && current.location && location !== current.location)
            || (record.branch_id && current.branch_id && record.branch_id !== current.branch_id)
        );
        if (needsBoundary) flush();
        if (!current) {
            current = {
                world_id: record.world_id || null,
                chat_id: record.chat_id || null,
                branch_id: record.branch_id || null,
                start_message: messageIndex,
                end_message: messageIndex,
                location: location || '',
                actors: [],
                open_items: [],
                transactions: [],
            };
        }
        if (!current.location && location) current.location = location;
        current.end_message = messageIndex;
        current.actors.push(...operationEntities(record));
        current.open_items.push(...operationOpenItems(record));
        current.transactions.push({
            transaction_id: txId,
            source_key: sourceKey,
            event_summary: clean(record.event_summary, 1200),
        });
    }
    flush();
    return scenes;
}

function tokenize(text) {
    const normalized = clean(text, 20_000).normalize('NFKC').toLocaleLowerCase();
    const out = new Set();
    for (const match of normalized.matchAll(/[a-z0-9_]{2,}|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu)) {
        const token = match[0];
        if (/^[a-z0-9_]+$/u.test(token)) {
            out.add(token);
            continue;
        }
        const chars = Array.from(token);
        if (chars.length === 1) out.add(chars[0]);
        for (let i = 0; i < chars.length - 1; i++) out.add(chars.slice(i, i + 2).join(''));
    }
    return out;
}

function sceneScore(scene, queryTerms) {
    const corpus = tokenize([scene.location, scene.actors?.join(' '), scene.outcome, scene.open_items?.join(' ')].filter(Boolean).join(' '));
    let overlap = 0;
    for (const term of queryTerms) if (corpus.has(term)) overlap += 1;
    return overlap;
}

export function selectSceneSummaries(sceneInput, queryText, { limit = 3 } = {}) {
    const scenes = Array.isArray(sceneInput) ? sceneInput : [];
    const cap = Math.max(0, Math.min(8, Number(limit) || 3));
    if (!cap || !scenes.length) return [];
    const terms = tokenize(queryText);
    const ranked = scenes.map((scene, index) => ({ scene, index, score: sceneScore(scene, terms) }))
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || b.index - a.index)
        .map(row => row.scene);
    const selected = [];
    const seen = new Set();
    const latest = scenes[scenes.length - 1];
    if (latest) {
        selected.push(latest);
        seen.add(latest.scene_id);
    }
    for (const scene of ranked) {
        if (seen.has(scene.scene_id)) continue;
        selected.push(scene);
        seen.add(scene.scene_id);
        if (selected.length >= cap) break;
    }
    return selected.slice(0, cap);
}

export function formatSceneSummaryBlock(sceneInput) {
    const scenes = Array.isArray(sceneInput) ? sceneInput : [];
    if (!scenes.length) return '';
    const lines = [
        '[SCENE SUMMARY LOCATORS — DERIVED, REBUILDABLE, NOT A SOURCE OF NEW FACTS]',
        'Use these only as coarse history locators. Source transaction ids identify the underlying event records; a scene summary never summarizes another scene summary.',
    ];
    for (const scene of scenes) {
        const attrs = [
            `id="${xmlEscape(scene.scene_id)}"`,
            `transactions="${xmlEscape((scene.source_transaction_ids || []).join(','))}"`,
            scene.location ? `location="${xmlEscape(scene.location)}"` : '',
        ].filter(Boolean).join(' ');
        lines.push(`<scene ${attrs}>${xmlEscape(scene.outcome || '')}${scene.open_items?.length ? ` | open: ${xmlEscape(scene.open_items.join(' / '))}` : ''}</scene>`);
    }
    return lines.join('\n');
}

/**
 * Expand a selected scene back to the event records it locates (proposal: "命中后可展开相关
 * 事件证据"). Only event/world_delta operation texts are surfaced, bounded by maxChars, and the
 * block is labeled as derived so it can never be mistaken for new facts.
 */
export function collectSceneEvidence(storeInput, scenesInput, { maxChars = 1200, perScene = 3 } = {}) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const scenes = Array.isArray(scenesInput) ? scenesInput : [];
    const extractions = store.extractions && typeof store.extractions === 'object' ? store.extractions : {};
    const lines = [];
    let used = 0;
    for (const scene of scenes) {
        const rows = [];
        for (const key of Array.isArray(scene?.source_keys) ? scene.source_keys : []) {
            const record = extractions[key];
            if (!record) continue;
            const ops = Array.isArray(record.operations) ? record.operations : [];
            for (const op of ops) {
                if (!op || op.op === 'noop') continue;
                if (!['event', 'world_delta'].includes(String(op.kind || ''))) continue;
                const text = clean(op.text, 600);
                if (text) rows.push(text);
            }
            if (!rows.length) {
                const summary = clean(record.event_summary, 600);
                if (summary) rows.push(summary);
            }
        }
        for (const text of unique(rows).slice(0, Math.max(0, Number(perScene) || 3))) {
            const line = `- [${clean(scene.scene_id, 60)}] ${text}`;
            if (used + line.length + 1 > Math.max(200, Number(maxChars) || 1200)) return lines.join('\n');
            lines.push(line);
            used += line.length + 1;
        }
    }
    return lines.join('\n');
}

export function injectSceneEvidenceBlock(referenceBlock, evidenceBlock) {
    const reference = String(referenceBlock ?? '');
    const evidence = clean(evidenceBlock, 20_000);
    if (!evidence) return reference;
    const block = `[SCENE EVIDENCE — LINKED EVENT RECORDS, DERIVED AND REBUILDABLE]\n${evidence}`;
    return reference ? `${reference}\n\n${block}` : `[PLUGIN REFERENCE DATA — NOT DIALOGUE]\n\n${block}`;
}

function latestQuery(chatInput) {
    const rows = Array.isArray(chatInput) ? chatInput : [];
    return rows.filter(row => row && isDialogueRow(row)).slice(-3).map(row => clean(row.mes, 5000)).filter(Boolean).join('\n');
}

function actorIdentity(ctx, store) {
    const aliases = unique([
        ctx?.name2,
        ctx?.character?.name,
        ctx?.characters?.[ctx?.characterId]?.name,
    ], 12).map(x => x.normalize('NFKC').toLocaleLowerCase());
    const ids = [];
    const expectedDiscriminator = ctx?.characterId !== undefined && ctx?.characterId !== null ? `st-character:${ctx.characterId}` : null;
    for (const row of Object.values(store?.entity_registry || {})) {
        if (!row?.entity_id) continue;
        if (expectedDiscriminator && row.discriminator === expectedDiscriminator) ids.push(row.entity_id);
        else if (!expectedDiscriminator && (row.aliases || []).some(alias => aliases.includes(clean(alias, 300).normalize('NFKC').toLocaleLowerCase()))) ids.push(row.entity_id);
    }
    return { aliases, ids: unique(ids, 20) };
}

function isPrivateMemoryVisible(memory, actor) {
    const names = unique(memory?.known_by, 30).map(x => x.normalize('NFKC').toLocaleLowerCase());
    const ids = unique(memory?.known_by_ids, 30);
    if (!names.length && !ids.length) return true;
    if (ids.some(id => actor.ids.includes(id))) return true;
    return names.some(name => actor.aliases.includes(name));
}

function removeExactMemoryFromPrompt(block, memory) {
    const raw = clean(memory?.text, 5000);
    if (!raw) return block;
    const escaped = xmlEscape(raw);
    // Current-state lines carry the raw text while reference records carry escaped text; a
    // one-sided comparison leaves XML-special-char secrets in the prompt while reporting them hidden.
    const matches = (text) => text.includes(raw) || (escaped !== raw && text.includes(escaped));
    let out = String(block ?? '');
    // Historical memories are XML-like records in Reference.
    out = out.replace(/<memory\b[^>]*>[\s\S]*?<\/memory>/g, tag => (tag.includes(`<summary>${raw}</summary>`) || tag.includes(`<summary>${escaped}</summary>`)) ? '' : tag);
    // Current-state records are line based. Both the canonical-state summary and
    // the grouped active-memory view contain the same escaped memory text.
    out = out.split('\n').filter(line => !matches(line)).join('\n');
    return out;
}

export function filterPrivateKnowledge(referenceBlock, currentStateBlock, storeInput, actorInput) {
    const store = storeInput && typeof storeInput === 'object' ? storeInput : {};
    const actor = actorInput || { aliases: [], ids: [] };
    let reference = String(referenceBlock ?? '');
    let current = String(currentStateBlock ?? '');
    const hidden = [];
    for (const memory of Object.values(store.memories || {})) {
        if (!memory || !['knowledge', 'belief'].includes(memory.kind)) continue;
        if (isPrivateMemoryVisible(memory, actor)) continue;
        hidden.push(memory.id || null);
        reference = removeExactMemoryFromPrompt(reference, memory);
        current = removeExactMemoryFromPrompt(current, memory);
    }
    return {
        referenceBlock: reference.replace(/\n{4,}/g, '\n\n\n').trim(),
        currentStateBlock: current.replace(/\n{4,}/g, '\n\n\n').trim(),
        hiddenMemoryIds: hidden.filter(Boolean),
    };
}

export function injectSceneSummaryBlock(referenceBlock, sceneBlock) {
    const reference = String(referenceBlock ?? '');
    const scenes = clean(sceneBlock, 20_000);
    if (!scenes) return reference;
    if (!reference) return `[PLUGIN REFERENCE DATA — NOT DIALOGUE]\n\n${scenes}`;
    const historicalMarker = '[HISTORICAL MEMORY — PAST EVENTS, NOT NECESSARILY CURRENT]';
    const index = reference.indexOf(historicalMarker);
    if (index < 0) return `${reference}\n\n${scenes}`;
    return `${reference.slice(0, index).trimEnd()}\n\n${scenes}\n\n${reference.slice(index)}`;
}

function activeRevisionIds(binding) {
    return new Set([binding?.baseline_revision_id, ...(binding?.extension_revision_ids || [])].filter(Boolean).map(String));
}

function visibleEntries(store, binding) {
    const ids = activeRevisionIds(binding);
    return Object.values(store?.entries || {})
        .filter(entry => entry?.world_id === binding?.world_id && ids.has(String(entry.revision_id)))
        .sort((a, b) => Number(a.order ?? Number.POSITIVE_INFINITY) - Number(b.order ?? Number.POSITIVE_INFINITY)
            || clean(a.title || a.comment || a.entry_id, 500).localeCompare(clean(b.title || b.comment || b.entry_id, 500)));
}

function parseKeys(text) {
    return unique(String(text ?? '').split(/[\n,，]+/u), 50);
}

function getOverrides(settingsRoot) {
    if (!settingsRoot.setting_entry_overrides || typeof settingsRoot.setting_entry_overrides !== 'object' || Array.isArray(settingsRoot.setting_entry_overrides)) {
        settingsRoot.setting_entry_overrides = {};
    }
    return settingsRoot.setting_entry_overrides;
}

function mountEntryEditor(ctx) {
    if (typeof document === 'undefined' || document.getElementById('aum-v55-entry-editor')) return false;
    const host = document.getElementById('aum-v55-chat-binding') || document.getElementById('aum-v54-settings');
    if (!host) return false;
    const root = document.createElement('div');
    root.id = 'aum-v55-entry-editor';
    root.className = 'aum-v54-section';
    root.innerHTML = `
        <h4>v5.5 Setting Entry Overlay</h4>
        <small>Imported Source/Revision remains immutable. Edits are stored as an overlay on the same revision scope, so Commit G can update only the changed Entry on the next index sync.</small>
        <label>Entry <select id="aum-v55-entry-select" class="text_pole"></select></label>
        <div class="aum-v51-grid">
            <label>Title<input id="aum-v55-entry-title" class="text_pole" type="text"></label>
            <label>Primary keys<input id="aum-v55-entry-keys" class="text_pole" type="text" placeholder="comma separated"></label>
            <label>Secondary keys<input id="aum-v55-entry-secondary" class="text_pole" type="text" placeholder="comma separated"></label>
            <label>Order<input id="aum-v55-entry-order" class="text_pole" type="number"></label>
        </div>
        <label>Content<textarea id="aum-v55-entry-content" class="text_pole" rows="8"></textarea></label>
        <label class="checkbox_label"><input id="aum-v55-entry-constant" type="checkbox"> Constant / core setting</label>
        <label class="checkbox_label"><input id="aum-v55-entry-disabled" type="checkbox"> Disabled</label>
        <div class="aum-v51-buttons">
            <button id="aum-v55-entry-save" class="menu_button">Save overlay</button>
            <button id="aum-v55-entry-clear" class="menu_button">Clear overlay</button>
        </div>
        <div id="aum-v55-entry-status" class="aum-v51-status">No Entry selected.</div>`;
    host.append(root);

    const select = root.querySelector('#aum-v55-entry-select');
    const title = root.querySelector('#aum-v55-entry-title');
    const keys = root.querySelector('#aum-v55-entry-keys');
    const secondary = root.querySelector('#aum-v55-entry-secondary');
    const order = root.querySelector('#aum-v55-entry-order');
    const content = root.querySelector('#aum-v55-entry-content');
    const constant = root.querySelector('#aum-v55-entry-constant');
    const disabled = root.querySelector('#aum-v55-entry-disabled');
    const status = root.querySelector('#aum-v55-entry-status');

    const renderEntry = () => {
        const settingsRoot = getSettingsRoot(ctx);
        const store = settingsRoot?.setting_store || {};
        const binding = ensureChatSettingBinding(ctx) || {};
        const entry = store.entries?.[select.value];
        if (!entry) {
            status.textContent = 'No Entry selected.';
            return;
        }
        const key = settingOverrideKey(entry.world_id, entry.revision_id, entry.entry_id);
        const overlay = getOverrides(settingsRoot)[key] || {};
        title.value = overlay.title !== undefined ? (overlay.title || '') : (entry.title || '');
        keys.value = (overlay.keys !== undefined ? overlay.keys : entry.keys || []).join(', ');
        secondary.value = (overlay.secondary_keys !== undefined ? overlay.secondary_keys : entry.secondary_keys || []).join(', ');
        order.value = overlay.order !== undefined && overlay.order !== null ? overlay.order : (entry.order ?? '');
        content.value = overlay.content !== undefined ? overlay.content : (entry.content || '');
        constant.checked = overlay.constant !== undefined ? Boolean(overlay.constant) : Boolean(entry.constant);
        disabled.checked = overlay.disabled !== undefined ? Boolean(overlay.disabled) : Boolean(entry.disabled);
        status.textContent = overlay.updated_at ? `Overlay active · ${new Date(overlay.updated_at).toLocaleString()}` : 'Using immutable imported Entry.';
    };

    const refresh = () => {
        const settingsRoot = getSettingsRoot(ctx);
        const store = settingsRoot?.setting_store || {};
        const binding = ensureChatSettingBinding(ctx) || {};
        const previous = select.value;
        select.replaceChildren();
        for (const entry of visibleEntries(store, binding)) {
            const option = document.createElement('option');
            option.value = entry.entry_id;
            option.textContent = `${entry.title || entry.comment || entry.entry_id} (${entry.revision_id})`;
            select.append(option);
        }
        if ([...select.options].some(option => option.value === previous)) select.value = previous;
        renderEntry();
    };

    select.addEventListener('change', renderEntry);
    root.querySelector('#aum-v55-entry-save').addEventListener('click', () => {
        const settingsRoot = getSettingsRoot(ctx);
        const store = settingsRoot?.setting_store || {};
        const entry = store.entries?.[select.value];
        if (!entry) return;
        const key = settingOverrideKey(entry.world_id, entry.revision_id, entry.entry_id);
        getOverrides(settingsRoot)[key] = normalizeSettingOverride({
            title: title.value,
            content: content.value,
            keys: parseKeys(keys.value),
            secondary_keys: parseKeys(secondary.value),
            constant: constant.checked,
            disabled: disabled.checked,
            order: order.value,
            base_content_hash: entry.content_hash || null,
            updated_at: Date.now(),
        });
        ctx.saveSettingsDebounced?.();
        status.textContent = 'Overlay saved. The next Setting Index sync/generation will use a same-scope per-Entry diff; imported Source/Revision was not rewritten.';
    });
    root.querySelector('#aum-v55-entry-clear').addEventListener('click', () => {
        const settingsRoot = getSettingsRoot(ctx);
        const store = settingsRoot?.setting_store || {};
        const entry = store.entries?.[select.value];
        if (!entry) return;
        delete getOverrides(settingsRoot)[settingOverrideKey(entry.world_id, entry.revision_id, entry.entry_id)];
        ctx.saveSettingsDebounced?.();
        renderEntry();
        status.textContent = 'Overlay cleared; immutable imported Entry is effective again.';
    });
    refresh();
    return true;
}

export function previewUntitledTextSegments(textInput, { limit = 8 } = {}) {
    const text = clean(textInput, 500_000).replace(/\r\n?/g, '\n');
    const hasHeading = text.split('\n').some(line => /^\s{0,3}#{1,2}\s+.+/u.test(line));
    if (hasHeading) return { applicable: false, reason: 'h1-h2-present', segments: [] };
    const paragraphs = text.split(/\n\s*\n+/u).map(x => clean(x, 20_000)).filter(Boolean);
    const source = paragraphs.length > 1 ? paragraphs : text.split(/(?<=[。！？!?])\s*(?=\S)/u).map(x => clean(x, 20_000)).filter(Boolean);
    return {
        applicable: true,
        reason: paragraphs.length > 1 ? 'paragraph-preview' : 'sentence-preview',
        total_segments: source.length,
        segments: source.slice(0, Math.max(1, Number(limit) || 8)).map((segment, index) => ({
            index,
            chars: segment.length,
            preview: segment.slice(0, 180),
        })),
    };
}

function mountUntitledPreview(ctx) {
    if (typeof document === 'undefined' || document.getElementById('aum-v55-untitled-preview')) return false;
    const fileInput = document.getElementById('aum-v54-setting-file');
    const previewHost = document.getElementById('aum-v54-setting-preview-output');
    if (!fileInput || !previewHost) return false;
    const box = document.createElement('pre');
    box.id = 'aum-v55-untitled-preview';
    box.className = 'aum-v51-status aum-v51-diagnostics';
    box.textContent = 'Untitled TXT segmentation preview appears here when needed.';
    previewHost.insertAdjacentElement('afterend', box);
    fileInput.addEventListener('change', () => {
        void (async () => {
            const file = fileInput.files?.[0];
            if (!file || !/\.(?:txt|md|markdown)$/i.test(file.name || '')) {
                box.textContent = 'Untitled TXT segmentation preview appears here when needed.';
                return;
            }
            const text = await file.text();
            const preview = previewUntitledTextSegments(text);
            if (!preview.applicable) {
                box.textContent = 'H1/H2 headings detected; normal heading segmentation will be used.';
                return;
            }
            const lines = [
                `Untitled TXT preview only · ${preview.reason} · candidate segments ${preview.total_segments}`,
                'Import remains conservative (one Entry) unless the source is explicitly titled; this preview lets you inspect likely boundaries before editing the file.',
                ...preview.segments.map(row => `${row.index + 1}. [${row.chars} chars] ${row.preview.replace(/\n/g, ' ')}`),
            ];
            box.textContent = lines.join('\n');
        })();
    });
    void ctx;
    return true;
}

function dynamicConstantLimit(settingsRoot, projectedStore, binding) {
    if (!settingsRoot || settingsRoot.v55_dynamic_constant_reserve === false) return null;
    const ids = activeRevisionIds(binding);
    const count = Object.values(projectedStore?.entries || {}).filter(entry => ids.has(String(entry.revision_id)) && !entry.disabled && entry.constant).length;
    const previous = settingsRoot.setting_retrieval_constant_limit;
    if (count > Number(previous || 0)) settingsRoot.setting_retrieval_constant_limit = Math.min(20, count);
    return previous;
}

export async function runWithV55Finalizer(ctx, innerInterceptor, args) {
    if (!ctx || typeof innerInterceptor !== 'function') return;
    const settingsRoot = getSettingsRoot(ctx);
    const chatStore = getChatStore(ctx);
    if (!settingsRoot || !chatStore) return innerInterceptor(...args);

    const binding = ensureChatSettingBinding(ctx) || {};
    stampRuntimeIdentity(ctx);
    const originalLibraryStore = settingsRoot.setting_store;
    const projected = applySettingOverrides(originalLibraryStore, settingsRoot.setting_entry_overrides, binding);
    settingsRoot.setting_store = projected.store;
    const previousConstantLimit = dynamicConstantLimit(settingsRoot, projected.store, binding);

    const realSetPrompt = typeof ctx.setExtensionPrompt === 'function' ? ctx.setExtensionPrompt.bind(ctx) : null;
    const captured = new Map();
    if (realSetPrompt) {
        ctx.setExtensionPrompt = (key, value, ...rest) => {
            if (key === REFERENCE_PROMPT_KEY || key === CURRENT_STATE_PROMPT_KEY) {
                captured.set(key, { key, value: String(value ?? ''), rest });
                return;
            }
            return realSetPrompt(key, value, ...rest);
        };
    }

    try {
        await innerInterceptor(...args);
    } finally {
        if (realSetPrompt) ctx.setExtensionPrompt = realSetPrompt;
        settingsRoot.setting_store = originalLibraryStore;
        if (previousConstantLimit !== null) settingsRoot.setting_retrieval_constant_limit = previousConstantLimit;
    }

    const scenes = buildSceneSummaries(chatStore);
    const sceneFingerprint = `scenes_${fnv1a32Runtime(scenes.map(scene => scene.fingerprint).join('|')).toString(36)}`;
    chatStore.scene_summaries = scenes;
    chatStore.scene_summary_fingerprint = sceneFingerprint;
    chatStore.scene_summary_source = 'extraction-transactions-only';

    // Suppressed generations (plugin disabled / quiet / impersonate) must keep the cleared
    // payloads emitted by the legacy interceptor; re-adding scene locators here would defeat
    // the documented cleanup contract.
    const generationType = String(args?.[3] || '').toLowerCase();
    const pluginOwnedQuiet = settingsRoot.__quiet_extraction_in_progress === true || settingsRoot.__hierarchical_summary_in_progress === true;
    const thirdPartyQuietInjection = settingsRoot.quiet_allow_third_party_injection === true && !pluginOwnedQuiet;
    const suppressed = settingsRoot.enabled === false
        || generationType === 'impersonate'
        || (generationType === 'quiet' && !thirdPartyQuietInjection);
    if (realSetPrompt && captured.size && suppressed) {
        for (const row of captured.values()) realSetPrompt(row.key, row.value, ...row.rest);
        ctx.saveMetadataDebounced?.();
        return;
    }
    if (realSetPrompt && captured.size) {
        const reference = captured.get(REFERENCE_PROMPT_KEY) || { key: REFERENCE_PROMPT_KEY, value: '', rest: [] };
        const current = captured.get(CURRENT_STATE_PROMPT_KEY) || { key: CURRENT_STATE_PROMPT_KEY, value: '', rest: [] };
        const actor = actorIdentity(ctx, chatStore);
        const visible = filterPrivateKnowledge(reference.value, current.value, chatStore, actor);
        // Scene summary + linked evidence are injected exactly once, by v55-consistency, from the
        // actor-sanitized store. Re-deriving them here duplicated both blocks and could carry
        // un-sanitized derivation text into the reference the outer wrapper re-emitted.
        const selectedScenes = selectSceneSummaries(scenes, latestQuery(args?.[0] || ctx.chat || []), { limit: 3 });
        const bounded = budgetPromptPair(visible.referenceBlock, visible.currentStateBlock, {
            contextSize: args?.[1],
            replyReserve: settingsRoot.context_reply_reserve_tokens,
            maxReferenceChars: settingsRoot.reference_context_max_chars,
            maxCurrentStateChars: settingsRoot.current_state_context_max_chars,
        });
        realSetPrompt(reference.key, bounded.referenceBlock, ...reference.rest);
        realSetPrompt(current.key, bounded.currentStateBlock, ...current.rest);
        chatStore.v55_finalizer_diagnostics = {
            override_entry_ids: projected.applied,
            override_ignored: projected.ignored,
            hidden_private_memory_ids: visible.hiddenMemoryIds,
            selected_scene_ids: selectedScenes.map(scene => scene.scene_id),
            scene_count: scenes.length,
            scene_fingerprint: sceneFingerprint,
            ...bounded.diagnostics,
            at: Date.now(),
        };
    }
    ctx.saveMetadataDebounced?.();
}

export function installV55Finalizer(getContext, interceptorName) {
    const ctx = getContext?.();
    if (!ctx) return false;
    const inner = globalThis[interceptorName];
    if (typeof inner !== 'function' || inner.__v55Finalized) return false;
    const wrapped = async (...args) => {
        const current = getContext?.() || ctx;
        return runWithV55Finalizer(current, inner, args);
    };
    wrapped.__v55Finalized = true;
    wrapped.__inner = inner;
    globalThis[interceptorName] = wrapped;

    const syncUi = () => {
        const current = getContext?.() || ctx;
        if (!current) return;
        mountEntryEditor(current);
        mountUntitledPreview(current);
    };
    const events = ctx.eventTypes || {};
    if (ctx.eventSource?.on && events.APP_READY) ctx.eventSource.on(events.APP_READY, () => setTimeout(syncUi, 0));
    if (ctx.eventSource?.on && events.CHAT_CHANGED) ctx.eventSource.on(events.CHAT_CHANGED, () => setTimeout(syncUi, 0));
    setTimeout(syncUi, 1050);
    return true;
}
