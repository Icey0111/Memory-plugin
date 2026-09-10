// Aetheria Unified Memory v5.5 — embedding-space profile and retrieval transport policy.
// Pure module: no SillyTavern globals and no network I/O.
//
// Canonical memory is authoritative; embeddings are replaceable derived indices. This module
// describes the embedding space (model + role transforms + score policy) so changing any of
// those semantics creates a new fingerprint instead of silently mixing incompatible vectors.

export const EMBEDDING_PROFILE_VERSION = 1;

export const EMBEDDING_FAMILIES = new Set([
    'auto', 'generic', 'jina', 'e5', 'bge', 'qwen3', 'openai', 'voyage',
]);

export const EMBEDDING_ROLE_STRATEGIES = new Set(['auto', 'symmetric', 'prefix']);
export const EMBEDDING_NORMALIZATION_HINTS = new Set(['auto', 'l2', 'none']);

const COLLECTION_PATTERNS = Object.freeze([
    ['probe', /^aetheria_v5[45]_vector_probe_/],
    ['setting', /^aetheria_v55_setting_/],
    ['baseline', /^aetheria_v54_baseline_/],
    ['memory', /^aetheria_v54_/],
]);

function clean(value, max = 10000) {
    const text = String(value ?? '').replace(/\u0000/g, '').trim();
    return text.length > max ? text.slice(0, max) : text;
}

function clamp01OrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.max(0, Math.min(1, n));
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function fnv1a32Embedding(input) {
    const text = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

export function detectEmbeddingFamily({ configured = 'auto', model = '', endpoint = '', provider = '' } = {}) {
    const requested = clean(configured).toLowerCase();
    if (EMBEDDING_FAMILIES.has(requested) && requested !== 'auto') return requested;
    const hay = `${model} ${endpoint} ${provider}`.toLowerCase();
    if (/\bjina(?:-|\s)|api\.jina\.ai/.test(hay)) return 'jina';
    if (/(^|[\/_-])e5(?:[-_]|$)|multilingual-e5|e5-large|e5-base|e5-small/.test(hay)) return 'e5';
    if (/\bbge(?:[-_]|\b)|baai\/bge/.test(hay)) return 'bge';
    if (/qwen3[-_/ ]?embedding|qwen.*embedding/.test(hay)) return 'qwen3';
    if (/voyage/.test(hay)) return 'voyage';
    if (/text-embedding-|openai/.test(hay)) return 'openai';
    return 'generic';
}

function defaultRoleStrategy(family) {
    // E5's public interface uses query:/passage: role prefixes. For other families the generic
    // SillyTavern vector bridge cannot safely assume a provider-specific task/instruction schema,
    // so auto mode remains symmetric unless the user explicitly configures prefixes.
    return family === 'e5' ? 'prefix' : 'symmetric';
}

function defaultPrefixes(family) {
    return family === 'e5'
        ? { query: 'query: ', document: 'passage: ' }
        : { query: '', document: '' };
}

export function normalizeEmbeddingProfile(input = {}) {
    const provider = clean(input.provider, 300).toLowerCase() || 'unknown';
    const model = clean(input.model, 500);
    const endpoint = clean(input.endpoint, 2000);
    const family = detectEmbeddingFamily({
        configured: input.family,
        model,
        endpoint,
        provider,
    });
    const requestedRole = clean(input.role_strategy).toLowerCase();
    const roleStrategy = EMBEDDING_ROLE_STRATEGIES.has(requestedRole) && requestedRole !== 'auto'
        ? requestedRole
        : defaultRoleStrategy(family);
    const defaults = defaultPrefixes(family);
    const queryPrefix = roleStrategy === 'prefix'
        ? (clean(input.query_prefix, 1000) || defaults.query)
        : '';
    const documentPrefix = roleStrategy === 'prefix'
        ? (clean(input.document_prefix, 1000) || defaults.document)
        : '';

    const dimensionRaw = input.dimensions === '' || input.dimensions == null ? null : Number(input.dimensions);
    const dimensions = Number.isInteger(dimensionRaw) && dimensionRaw > 0 ? dimensionRaw : null;
    const normalizationInput = clean(input.normalization).toLowerCase();
    const normalization = EMBEDDING_NORMALIZATION_HINTS.has(normalizationInput)
        ? normalizationInput
        : 'auto';

    const scorePolicyInput = input.score_policy && typeof input.score_policy === 'object'
        ? input.score_policy
        : {};
    const scorePolicy = {
        memory: clamp01OrNull(scorePolicyInput.memory),
        setting: clamp01OrNull(scorePolicyInput.setting),
        baseline: clamp01OrNull(scorePolicyInput.baseline),
    };

    const multiQueryFusion = input.multi_query_fusion !== false;
    const multiQueryRrfK = Math.max(1, Math.min(500, Math.trunc(Number(input.multi_query_rrf_k) || 60)));

    const warnings = [];
    if (family === 'jina') {
        warnings.push('Jina 的 retrieval.query / retrieval.passage task 不能由当前 SillyTavern vLLM 桥接可靠表达；自动模式保持对称向量，不伪造 task。');
    }
    if (dimensions) {
        warnings.push('dimensions 是向量空间指纹提示；当前宿主 Vector API 不保证会把 dimensions 参数转发给供应商。');
    }
    if (normalization !== 'auto') {
        warnings.push('normalization 是向量空间指纹提示；实际归一化由模型/宿主向量后端决定。');
    }

    const spacePayload = {
        version: EMBEDDING_PROFILE_VERSION,
        provider,
        model,
        endpoint,
        family,
        role_strategy: roleStrategy,
        query_prefix: queryPrefix,
        document_prefix: documentPrefix,
        dimensions,
        normalization,
    };
    const retrievalPolicyPayload = {
        version: EMBEDDING_PROFILE_VERSION,
        score_policy: scorePolicy,
        multi_query_fusion: multiQueryFusion,
        multi_query_rrf_k: multiQueryRrfK,
    };
    const spaceFingerprint = `es${EMBEDDING_PROFILE_VERSION}:${fnv1a32Embedding(stableStringify(spacePayload)).toString(36)}`;
    const retrievalPolicyFingerprint = `rp${EMBEDDING_PROFILE_VERSION}:${fnv1a32Embedding(stableStringify(retrievalPolicyPayload)).toString(36)}`;

    return {
        ...spacePayload,
        ...retrievalPolicyPayload,
        fingerprint: spaceFingerprint,
        space_fingerprint: spaceFingerprint,
        retrieval_policy_fingerprint: retrievalPolicyFingerprint,
        warnings,
        capabilities: {
            asymmetric_text_roles: roleStrategy === 'prefix',
            native_task_forwarding: false,
            score_calibration: Object.values(scorePolicy).some(Number.isFinite),
            multi_query_fusion: multiQueryFusion,
        },
    };
}

export function applyEmbeddingRoleText(textInput, profileInput, role = 'generic') {
    const text = clean(textInput, 200000);
    if (!text) return '';
    const profile = profileInput?.fingerprint ? profileInput : normalizeEmbeddingProfile(profileInput);
    if (profile.role_strategy !== 'prefix') return text;
    const normalizedRole = clean(role).toLowerCase();
    const prefix = normalizedRole === 'query'
        ? profile.query_prefix
        : normalizedRole === 'document'
            ? profile.document_prefix
            : '';
    if (!prefix || text.startsWith(prefix)) return text;
    return `${prefix}${text}`;
}

export function classifyAetheriaCollection(collectionIdInput) {
    const collectionId = clean(collectionIdInput, 2000);
    for (const [kind, pattern] of COLLECTION_PATTERNS) {
        if (pattern.test(collectionId)) return kind;
    }
    return 'unknown';
}

export function resolveCalibratedThreshold(profileInput, collectionKind, requestedThreshold) {
    const profile = profileInput?.fingerprint ? profileInput : normalizeEmbeddingProfile(profileInput);
    const requested = clamp01OrNull(requestedThreshold) ?? 0;
    const kind = clean(collectionKind).toLowerCase();
    const calibrated = clamp01OrNull(profile.score_policy?.[kind]);
    return calibrated == null ? requested : calibrated;
}

function parseSections(textInput) {
    const text = clean(textInput, 100000);
    const sections = new Map();
    const re = /^\[([^\]\n]{2,80})\]\s*$/gm;
    const matches = [...text.matchAll(re)];
    if (!matches.length) return sections;
    for (let i = 0; i < matches.length; i++) {
        const label = clean(matches[i][1], 80).toUpperCase();
        const start = matches[i].index + matches[i][0].length;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        const body = clean(text.slice(start, end), 16000);
        if (body) sections.set(label, body);
    }
    return sections;
}

function addView(out, name, text, weight) {
    const value = clean(text, 16000);
    if (!value) return;
    const key = value.replace(/\s+/g, ' ').toLowerCase();
    if (out.some(row => row._key === key)) return;
    out.push({ name, text: value, weight, _key: key });
}

/**
 * Split Aetheria's labeled Setting query into independent semantic views.
 * Unlabeled memory/baseline queries remain one view. Keeping views separate avoids collapsing
 * current focus, entities/location, and objectives into one averaged semantic direction.
 */
export function buildTransportQueryViews(searchText, { maxViews = 4 } = {}) {
    const text = clean(searchText, 100000);
    if (!text) return [];
    const sections = parseSections(text);
    if (!sections.size) return [{ name: 'default', text, weight: 1 }];

    const out = [];
    const first = (...labels) => labels.map(label => sections.get(label)).find(Boolean) || '';
    const join = (...labels) => labels.map(label => sections.get(label)).filter(Boolean).join('\n');

    addView(out, 'focus', first('LAST USER', 'CURRENT USER'), 1.0);
    addView(out, 'assistant_context', first('PREVIOUS ASSISTANT', 'CURRENT ASSISTANT'), 0.72);
    addView(out, 'entity_scene', join('CURRENT SCENE ENTITIES', 'AFFECTED / CURRENT ENTITIES', 'ACTIVE LOCATION', 'CURRENT STATE SLOTS'), 0.88);
    addView(out, 'state_objective', join('OPEN COMMITMENTS / OBJECTIVES', 'CURRENT STATE HINT'), 0.66);

    if (!out.length) return [{ name: 'default', text, weight: 1 }];
    return out.slice(0, Math.max(1, Math.min(8, Number(maxViews) || 4)))
        .map(({ _key, ...row }) => row);
}

function metadataKey(row, fallbackIndex) {
    const hash = Number(row?.hash);
    if (Number.isFinite(hash)) return `h:${hash}`;
    const index = Number(row?.index);
    if (Number.isInteger(index)) return `i:${index}`;
    return `f:${fallbackIndex}:${fnv1a32Embedding(stableStringify(row || {})).toString(36)}`;
}

/** Fuse multiple vector-query result rankings without comparing provider-specific score scales. */
export function fuseRankedMetadata(resultListsInput, {
    weights = [],
    rrfK = 60,
    topK = 20,
} = {}) {
    const lists = Array.isArray(resultListsInput) ? resultListsInput : [];
    const k = Math.max(1, Math.min(1000, Number(rrfK) || 60));
    const limit = Math.max(1, Math.min(500, Number(topK) || 20));
    const byKey = new Map();

    lists.forEach((list, listIndex) => {
        const weight = Math.max(0, Number(weights[listIndex] ?? 1) || 0);
        (Array.isArray(list) ? list : []).forEach((row, rank) => {
            const key = metadataKey(row, rank);
            const current = byKey.get(key) || {
                row: { ...(row || {}) },
                score: 0,
                channels: [],
            };
            current.score += weight / (k + rank + 1);
            current.channels.push(listIndex);
            byKey.set(key, current);
        });
    });

    return [...byKey.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(entry => ({
            ...entry.row,
            _aum_rrf_score: entry.score,
            _aum_rrf_channels: entry.channels,
        }));
}
