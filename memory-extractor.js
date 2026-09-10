/**
 * Aetheria Unified Memory v5.4 - autonomous memory extractor.
 * Pure helpers live here so the extraction contract can be tested without SillyTavern.
 */

export const EXTRACTION_VERSION = '5.4';

export const MEMORY_KINDS_V54 = [
    'event', 'state', 'knowledge', 'belief', 'relation',
    'commitment', 'ownership', 'intention', 'world_delta',
];

export const MEMORY_OPS_V54 = [
    'add', 'update', 'close', 'supersede', 'reinforce', 'invalidate', 'noop',
];

const MEMORY_STATUSES = ['active', 'closed', 'superseded', 'invalid'];
const IMPORTANCE = ['low', 'medium', 'high', 'critical'];
const EPISTEMIC = ['fact', 'observed', 'reported', 'rumor', 'belief', 'inference', 'plan'];
// S6: how the holder came to know it. Separate from epistemic, which says how certain it is.
const CHANNELS = ['saw', 'heard', 'told', 'inferred'];

// SillyTavern's structured-output wrapper. The inner schema intentionally avoids oneOf-heavy
// constraints because provider support varies; runtime validation remains authoritative.
export const EXTRACTION_JSON_SCHEMA = {
    name: 'AetheriaMemoryExtractionV54',
    description: 'Extract event summary, current active state and incremental unified-memory operations from the latest dialogue pair.',
    strict: false,
    value: {
        '$schema': 'http://json-schema.org/draft-04/schema#',
        type: 'object',
        properties: {
            event_summary: { type: 'string' },
            active_state: { type: 'string' },
            operations: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        op: { type: 'string', enum: MEMORY_OPS_V54 },
                        kind: { type: 'string', enum: MEMORY_KINDS_V54 },
                        text: { type: 'string' },
                        entities: { type: 'array', items: { type: 'string' } },
                        topics: { type: 'array', items: { type: 'string' } },
                        slot: { type: 'string' },
                        target_id: { type: 'string' },
                        target_slot: { type: 'string' },
                        status: { type: 'string', enum: MEMORY_STATUSES },
                        importance: { type: 'string', enum: IMPORTANCE },
                        epistemic: { type: 'string', enum: EPISTEMIC },
                        channel: { type: 'string', enum: CHANNELS },
                        known_by: { type: 'array', items: { type: 'string' } },
                        indexable: { type: 'boolean' },
                        scope: { type: 'string', maxLength: 200 },
                        reason: { type: 'string' },
                    },
                    required: ['op'],
                    additionalProperties: false,
                },
            },
        },
        required: ['event_summary', 'active_state', 'operations'],
        additionalProperties: false,
    },
};

function cleanString(value, max = 4000) {
    return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function uniqueStrings(input, maxItems = 20) {
    return [...new Set((Array.isArray(input) ? input : [])
        .map(x => cleanString(x, 160))
        .filter(Boolean))].slice(0, maxItems);
}

export function normalizeExtractionOperation(op) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return null;
    const out = { op: cleanString(op.op, 32) };
    if (!MEMORY_OPS_V54.includes(out.op)) return null;

    for (const key of ['kind', 'text', 'slot', 'target_id', 'target_slot', 'status', 'importance', 'epistemic', 'channel', 'scope', 'reason']) {
        if (op[key] !== undefined && op[key] !== null) out[key] = cleanString(op[key], key === 'text' ? 1200 : 500);
    }
    if (op.entities !== undefined) out.entities = uniqueStrings(op.entities);
    if (op.topics !== undefined) out.topics = uniqueStrings(op.topics);
    if (op.known_by !== undefined) out.known_by = uniqueStrings(op.known_by, 40);
    if (typeof op.indexable === 'boolean') out.indexable = op.indexable;

    if (out.kind && !MEMORY_KINDS_V54.includes(out.kind)) delete out.kind;
    if (out.status && !MEMORY_STATUSES.includes(out.status)) delete out.status;
    if (out.importance && !IMPORTANCE.includes(out.importance)) delete out.importance;
    if (out.epistemic && !EPISTEMIC.includes(out.epistemic)) delete out.epistemic;
    if (out.channel && !CHANNELS.includes(out.channel)) delete out.channel;
    return out;
}

export function parseExtractionResult(raw) {
    const src = String(raw ?? '').trim();
    if (!src) return { ok: false, error: 'empty extraction result', eventSummary: '', activeState: '', operations: [] };

    let parsed = null;
    const candidates = [
        src,
        src.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim(),
    ];
    for (const candidate of candidates) {
        try {
            parsed = JSON.parse(candidate);
            break;
        } catch {}
    }
    if (!parsed) {
        const start = src.indexOf('{');
        const end = src.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try { parsed = JSON.parse(src.slice(start, end + 1).replace(/,(\s*[}\]])/g, '$1')); } catch {}
        }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'invalid JSON object', eventSummary: '', activeState: '', operations: [] };
    }

    if (!Array.isArray(parsed.operations)) {
        return { ok: false, error: 'operations must be an array', eventSummary: '', activeState: '', operations: [], warnings: [] };
    }
    const warnings = [];
    if (typeof parsed.event_summary !== 'string' || !parsed.event_summary.trim()) warnings.push('missing event_summary');
    if (typeof parsed.active_state !== 'string' || !parsed.active_state.trim()) warnings.push('missing active_state');
    const rawOperations = parsed.operations;
    const operations = rawOperations.map(normalizeExtractionOperation).filter(Boolean);
    const droppedOperations = rawOperations.length - operations.length;

    return {
        ok: true,
        error: null,
        warnings,
        droppedOperations,
        eventSummary: cleanString(parsed.event_summary, 1800),
        activeState: cleanString(parsed.active_state, 1800),
        operations,
    };
}

/**
 * Which optional context windows an extraction prompt can afford.
 *
 * Measured live: attaching every window at once produced `Got response status 502` from the gateway,
 * and a refused request costs that turn its extraction completely. The dialogue pair under review is
 * mandatory; every other window is context and has to yield. Layers are admitted in usefulness order,
 * and a layer that does not fit is dropped WHOLE — never sliced mid-sentence, because a half window is
 * worse than no window: it reads as complete to the model.
 */
export const EXTRACTION_CONTEXT_LAYERS = Object.freeze([
    'canonicalState',
    'recentContext',
    'relevantSettingContext',
    'hostBaselineContext',
]);

export function planExtractionPromptBudget({
    limit = 20000,
    pairChars = 0,
    layerChars = {},
    reserveChars = 1200,
} = {}) {
    const cap = Math.max(2000, Number(limit) || 20000);
    const pair = Math.max(0, Number(pairChars) || 0);
    const reserve = Math.max(0, Number(reserveChars) || 0);
    let available = cap - pair - reserve;
    const ceilings = { canonicalState: 0, recentContext: 0, relevantSettingContext: 0, hostBaselineContext: 0 };
    const dropped = [];
    for (const layer of EXTRACTION_CONTEXT_LAYERS) {
        const want = Math.max(0, Number(layerChars?.[layer]) || 0);
        if (!want) { ceilings[layer] = 0; continue; }
        if (available <= 0) { ceilings[layer] = 0; dropped.push(layer); continue; }
        ceilings[layer] = Math.min(want, available);
        available -= ceilings[layer];
    }
    return {
        limit: cap,
        pair_chars: pair,
        reserve_chars: reserve,
        ceilings,
        dropped,
        planned_chars: pair + reserve + EXTRACTION_CONTEXT_LAYERS.reduce((sum, layer) => sum + ceilings[layer], 0),
    };
}

export function buildAutonomousExtractionPrompt({
    userText,
    assistantText,
    recentContext = '',
    canonicalState = '',
    relevantSettingContext = '',
    hostBaselineContext = '',
    baselineHint = '', // compatibility with older callers
    optionalCeilings = null,
} = {}) {
    // The pair is never budgeted away; only the context windows are.
    const ceilings = optionalCeilings && typeof optionalCeilings === 'object' ? optionalCeilings : null;
    const capFor = (layer, fallback) => (ceilings ? Math.max(0, Number(ceilings[layer]) || 0) : fallback);
    const user = cleanString(userText, 12000);
    const assistant = cleanString(assistantText, 24000);
    const recent = cleanString(recentContext, capFor('recentContext', 16000));
    const canonical = cleanString(canonicalState, capFor('canonicalState', 12000));
    const relevantSetting = cleanString(relevantSettingContext, capFor('relevantSettingContext', 12000));
    const hostBaseline = cleanString(hostBaselineContext, capFor('hostBaselineContext', 8000));
    const legacyBaseline = cleanString(baselineHint, 16000);

    return `你是一个后台记忆抽取器。你不参与角色扮演，不续写故事，不改变正文。\n\n你的唯一任务：分析“最新一组用户消息 + AI回复”，生成艾瑟瑞亚 Unified Memory v5.4 的机器记忆结果。\n\n【重要架构】\n1. 不区分短期记忆/长期记忆。\n2. event_summary = 只概括这一次回复真正发生了什么。\n3. active_state = 当前此刻仍成立、下一轮直接续写需要知道的动态状态。已完成、已恢复、已离开场景的状态不要保留。\n4. operations = 对统一记忆池的增量操作；不是全量快照。\n5. 只有未来具有回忆/状态价值的内容才写 operations。普通动作、一次性饮食过程、无后果小额消费通常不写。\n\n【Baseline Filter】\n角色卡、Persona、World Info/世界书中本来就存在且没有被剧情改变的事实，不得重复 add。\n例如：既有住址、专业、兴趣、基础性格、外貌、固有能力、既有宠物/契约、既有账号/A网络权限、世界规则。\n如果世界书早已存在事实 X，但本轮剧情真正新增的是“某角色现在知道/确认了 X”，写 knowledge（谁知道了什么），不要重新登记 X 作为世界事实。
你的输出之后还会经过独立 Semantic Baseline 写入硬门；不要依赖硬门兜底，抽取阶段仍应主动避免基线重复。\n\n【证据原则】\noperations 必须能从最新用户消息或最新AI正文直接得到，或是对已有 active 状态的明确更新。\n传闻/猜测/计划分别使用 rumor/belief/inference/plan，不得升级为 fact。\n每条 operation 还要写 channel，表示该角色是「怎么知道的」：saw=亲眼所见或亲身经历，heard=在场听到他人说，told=事后被他人告知或转述，inferred=由已知信息推断。判断不了就留空。\n不要把模型因为看到系统提示/世界书而知道的事情，写成角色已经知道。\n\n【scope 适用范围】\n如果某条断言只在特定场景/条件/项目下成立（例如“学习数学时”“仅限终末星港”），在 op.scope 写这个适用范围；全局成立就留空。不要用 scope 表达时间点。\n\n【kind】\nevent / state / knowledge / belief / relation / commitment / ownership / intention / world_delta\n\n【op】\nadd / update / close / supersede / reinforce / invalidate / noop\n\n【slot】\n可更新状态尽量给稳定 slot，例如“平成.state.hunger”“平成.location.current”“平成.intention.east_street_dinner”。\n状态结束时优先 close target_slot。新事实推翻旧 belief/knowledge 时使用 supersede。\n\n【向量策略】\nindexable=true：值得未来语义召回的重要事件、关系、知识、承诺、重要失败/成功。\nindexable=false：当前状态、临时意图、低价值瞬时信息。\n不要为了凑数量创建记忆。\n\n【实体与主题】\nindexable=true 时尽量填写具体 entities/topics；text 必须自包含，使用真实名字，避免只写“她/那里/那个”。\n\n【当前 Canonical 状态摘要】\n${canonical || '（无）'}\n\n【最近上下文，仅用于消歧；不要把其中旧事件重新当成新事件】\n${recent || '（无）'}\n\n【与本轮变化相关的插件世界设定】
${relevantSetting || '（当前插件世界没有召回到相关设定；不要因此假定不存在其他基线事实。）'}

【与本轮相关的 Host Baseline】
${hostBaseline || legacyBaseline || `Persona / Character / Host World Info 若存在，仍属于基线资料；写入层会独立查询完整基线。`}

注意：以上设定是客观参考数据，不等于场景中每个角色都知道。只有正文明确发生“某角色得知/确认”时，才能写 knowledge。

【最新用户消息】\n${user || '（空）'}\n\n【最新AI正文】\n${assistant || '（空）'}\n\n只返回一个 JSON 对象，字段必须是：\n{\n  "event_summary": "...",\n  "active_state": "...",\n  "operations": [ ... ]\n}\n\n如果没有值得写入统一记忆池的变化，operations 返回：\n[{"op":"noop","reason":"本轮只有普通场景推进，没有值得进入统一记忆池的新变化。"}]`;
}
