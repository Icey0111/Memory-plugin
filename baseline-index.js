// Aetheria Unified Memory v5.4 — Semantic Baseline Index (pure core)
//
// This module intentionally contains no SillyTavern globals. It turns canonical
// Persona / character-card / World Info text into deterministic baseline records
// and evaluates whether an extracted add-op is merely restating that baseline.
// The vector index is a rebuildable projection; these records are regenerated
// from host sources whenever their fingerprint changes.

export const BASELINE_VERSION = '5.4';

export function fnv1a32Baseline(input) {
    const str = String(input ?? '');
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

export function normalizeBaselineText(input) {
    return String(input ?? '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function cleanDisplayText(input) {
    return String(input ?? '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * The same tokenization, keeping term frequencies.
 *
 * BM25 needs a count per term, not a membership test, and a scorer that tokenizes differently from
 * the index would rank a different document set for the same query. Keys come out in
 * first-occurrence order, which is exactly what the deduplicated form used to return.
 */
export function baselineTermCounts(input) {
    const s = normalizeBaselineText(input);
    const counts = new Map();
    if (!s) return counts;
    const bump = term => counts.set(term, (counts.get(term) || 0) + 1);
    for (const term of s.match(/[a-z0-9_][a-z0-9_.:/+-]*/g) || []) bump(term);
    for (const run of s.match(/[\u3400-\u9fff]+/g) || []) {
        if (run.length === 1) bump(run);
        for (let n = 2; n <= 3; n++) {
            for (let i = 0; i <= run.length - n; i++) bump(run.slice(i, i + n));
        }
    }
    return counts;
}

export function tokenizeBaselineText(input) {
    return [...baselineTermCounts(input).keys()];
}

function sentencePieces(text) {
    const src = cleanDisplayText(text);
    if (!src) return [];
    const paragraphs = src.split(/\n{2,}/).map(x => x.trim()).filter(Boolean);
    const pieces = [];
    for (const p of paragraphs) {
        const rows = p.split(/\n+/).map(x => x.trim()).filter(Boolean);
        for (const row of rows) {
            const sentences = row.split(/(?<=[。！？!?；;])\s*/u).map(x => x.trim()).filter(Boolean);
            pieces.push(...(sentences.length ? sentences : [row]));
        }
    }
    return pieces;
}

export function splitBaselineText(input, { maxChars = 420, minChars = 18 } = {}) {
    const max = Math.max(120, Math.min(1200, Number(maxChars) || 420));
    const min = Math.max(1, Math.min(max, Number(minChars) || 18));
    const pieces = sentencePieces(input);
    const chunks = [];
    let current = '';
    const flush = () => {
        const t = current.trim();
        if (t) chunks.push(t);
        current = '';
    };
    for (let piece of pieces) {
        if (piece.length > max) {
            flush();
            while (piece.length > max) {
                let cut = piece.lastIndexOf('，', max);
                if (cut < Math.floor(max * 0.55)) cut = piece.lastIndexOf(',', max);
                if (cut < Math.floor(max * 0.55)) cut = max;
                chunks.push(piece.slice(0, cut + (cut < max ? 1 : 0)).trim());
                piece = piece.slice(cut + (cut < max ? 1 : 0)).trim();
            }
            if (piece) current = piece;
            continue;
        }
        if (!current) current = piece;
        else if ((current.length + 1 + piece.length) <= max) current += ` ${piece}`;
        else { flush(); current = piece; }
    }
    flush();

    // Merge tiny tail chunks when this does not explode the upper bound.
    const merged = [];
    for (const chunk of chunks) {
        if (merged.length && chunk.length < min && merged[merged.length - 1].length + 1 + chunk.length <= max) {
            merged[merged.length - 1] += ` ${chunk}`;
        } else merged.push(chunk);
    }
    return merged.filter(Boolean);
}

export function buildBaselineRecords(sourcesInput, options = {}) {
    const sources = Array.isArray(sourcesInput) ? sourcesInput : [];
    const records = [];
    for (const raw of sources) {
        if (!raw || typeof raw !== 'object') continue;
        const text = cleanDisplayText(raw.text);
        if (!text) continue;
        const sourceType = String(raw.source_type || raw.type || 'unknown').trim() || 'unknown';
        const sourceId = String(raw.source_id || raw.id || raw.title || sourceType).trim() || sourceType;
        const title = String(raw.title || sourceId).trim() || sourceId;
        const chunks = splitBaselineText(text, options);
        chunks.forEach((chunk, chunkIndex) => {
            const normalized = normalizeBaselineText(chunk);
            if (!normalized) return;
            const idSeed = `${sourceType}|${sourceId}|${chunkIndex}|${normalized}`;
            records.push({
                id: `b_${fnv1a32Baseline(idSeed).toString(36)}`,
                source_type: sourceType,
                source_id: sourceId,
                title,
                chunk_index: chunkIndex,
                text: chunk,
                normalized,
                tokens: tokenizeBaselineText(chunk),
            });
        });
    }
    return records;
}

export function computeBaselineFingerprint(recordsInput) {
    const rows = (Array.isArray(recordsInput) ? recordsInput : [])
        .map(r => `${r?.source_type || ''}|${r?.source_id || ''}|${r?.chunk_index ?? ''}|${r?.normalized || normalizeBaselineText(r?.text)}`)
        .sort();
    return `baseline54:${fnv1a32Baseline(rows.join('\n')).toString(36)}:${rows.length}`;
}

export function baselineLexicalSimilarity(aInput, bInput) {
    const a = normalizeBaselineText(aInput);
    const b = normalizeBaselineText(bInput);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length > b.length ? a : b;
    if (shorter.length >= 8 && longer.includes(shorter)) {
        return Math.min(0.99, 0.88 + 0.11 * (shorter.length / Math.max(1, longer.length)));
    }
    const ta = new Set(tokenizeBaselineText(a));
    const tb = new Set(tokenizeBaselineText(b));
    if (!ta.size || !tb.size) return 0;
    let intersection = 0;
    for (const t of ta) if (tb.has(t)) intersection += 1;
    const union = ta.size + tb.size - intersection;
    const jaccard = union ? intersection / union : 0;
    const containment = intersection / Math.max(1, Math.min(ta.size, tb.size));
    return Math.max(jaccard, containment * 0.92);
}

const CHANGE_MARKERS = [
    '搬到', '搬离', '迁居', '改为', '改成', '转为', '变为', '不再', '失去', '获得', '新增', '新建',
    '首次', '解除', '终止', '签订', '离开', '改修', '转专业', '开始知道', '得知', '确认了', '发现了',
    '卖掉', '卖出', '转让', '搬走', '去世', '离职', '辞职', '入学', '毕业', '结婚', '离婚', '破产',
    '损坏', '毁掉', '放弃', '改名', '换了', '停止', '恢复',
    'moved to', 'moved from', 'changed to', 'switched to', 'no longer', 'lost ', 'gained ', 'newly ',
    'learned that', 'discovered that', 'confirmed that', 'terminated', 'signed ', 'sold ', 'quit ', 'graduated',
];

export function hasExplicitChangeSignal(text) {
    const n = normalizeBaselineText(text);
    return CHANGE_MARKERS.some(marker => n.includes(normalizeBaselineText(marker)));
}

export function isBaselineGateEligible(op) {
    if (!op || op.op !== 'add' || !op.text) return false;
    // These encode story occurrence, epistemic change, uncertainty, intent, or explicit world change.
    // They can mention baseline facts without being duplicates of the baseline itself.
    if (['event', 'knowledge', 'belief', 'intention', 'world_delta'].includes(op.kind)) return false;
    if (hasExplicitChangeSignal(op.text)) return false;
    if (op.kind === 'state') {
        const slot = String(op.slot || '').toLowerCase();
        const clearlyDynamic = op.indexable === false || /(?:\.location\.current|\.state\.(?:hunger|fatigue|pain|injury|mp|cooldown|temperature|mood)|\.travel\.|\.intention\.)/.test(slot);
        if (clearlyDynamic) return false;
    }
    return ['state', 'relation', 'commitment', 'ownership'].includes(op.kind);
}

function hasSemanticAnchor(op, record) {
    const hay = normalizeBaselineText(record?.text || '');
    if (!hay) return false;
    const topics = Array.isArray(op?.topics) ? op.topics : [];
    for (const raw of topics) {
        const n = normalizeBaselineText(raw);
        if (n.length >= 2 && hay.includes(n)) return true;
    }
    // Entity-only anchoring is deliberately stricter because the protagonist's name occurs everywhere.
    const entities = (Array.isArray(op?.entities) ? op.entities : [])
        .map(normalizeBaselineText)
        .filter(n => n.length >= 3);
    return entities.some(n => hay.includes(n));
}

export function evaluateBaselineDuplicate(op, recordsInput, {
    lexicalThreshold = 0.78,
    semanticMatches = [],
    semanticThreshold = 0.84,
    semanticLexicalFloor = 0.16,
} = {}) {
    if (!isBaselineGateEligible(op)) return { blocked: false, reason: 'ineligible' };
    const records = Array.isArray(recordsInput) ? recordsInput : [];
    const opEntityIds = (Array.isArray(op?.entity_ids) ? op.entity_ids : []).filter(Boolean);
    let best = null;
    for (const record of records) {
        // Same display name must not mean the same entity: when both sides carry explicit entity
        // ids and they are disjoint, the record cannot be a duplicate of this operation.
        const recordEntityIds = (Array.isArray(record?.entity_ids) ? record.entity_ids : []).filter(Boolean);
        if (opEntityIds.length && recordEntityIds.length && !opEntityIds.some(id => recordEntityIds.includes(id))) continue;
        const score = baselineLexicalSimilarity(op.text, record.text);
        if (!best || score > best.score) best = { record, score };
    }
    if (best && best.score >= lexicalThreshold) {
        return { blocked: true, reason: 'lexical-baseline-duplicate', match: best.record, lexical_score: best.score };
    }

    const matchRows = Array.isArray(semanticMatches) ? semanticMatches : [];
    for (const row of matchRows) {
        const record = row?.record || records.find(r => r.id === row?.record_id || r.chunk_index === row?.index);
        if (!record) continue;
        const semanticScore = Number(row?.score ?? row?.similarity ?? semanticThreshold);
        const lexicalScore = baselineLexicalSimilarity(op.text, record.text);
        // SillyTavern's vector query only returns rows that passed threshold; some providers do not expose score.
        const semPassed = Number.isFinite(semanticScore) ? semanticScore >= semanticThreshold : true;
        if (semPassed && (lexicalScore >= semanticLexicalFloor || hasSemanticAnchor(op, record))) {
            return {
                blocked: true,
                reason: 'semantic-baseline-duplicate',
                match: record,
                semantic_score: Number.isFinite(semanticScore) ? semanticScore : null,
                lexical_score: lexicalScore,
            };
        }
    }
    return { blocked: false, reason: 'no-baseline-duplicate', best_lexical: best?.score ?? 0 };
}

