// Aetheria Unified Memory v5.5 — hierarchical automatic summarization.
// Summaries are generated after completed assistant turns, can use the current SillyTavern API
// or an independent Connection Manager profile, and are stored in chat metadata as a rebuildable tree.

const SETTINGS_KEY = 'aetheriaUnifiedMemoryV54';
const METADATA_KEY = 'aetheriaUnifiedMemoryV54';
const SUMMARY_PROMPT_KEY = 'aetheria_unified_memory_v5_5_hierarchical_summary';
const IN_CHAT = 1;
const SYSTEM_ROLE = 0;

const DEFAULTS = Object.freeze({
    hierarchical_summary_enabled: true,
    summary_provider_mode: 'current', // current | connection_profile
    summary_connection_profile_id: '',
    summary_max_tokens: 600,
    summary_level1_every_turns: 1,
    summary_level2_every_l1: 3,
    summary_level3_every_l2: 3,
    summary_injection_depth: 4,
    summary_max_context_chars: 6000,
    summary_auto_rebuild_on_history_change: false,
});

let installed = false;
let summaryQueue = Promise.resolve();
let scheduledTimer = null;
let sharedModulePromise = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function ensureSettings(ctx) {
    if (!ctx?.extensionSettings) return null;
    if (!ctx.extensionSettings[SETTINGS_KEY] || typeof ctx.extensionSettings[SETTINGS_KEY] !== 'object') {
        ctx.extensionSettings[SETTINGS_KEY] = {};
    }
    const settings = ctx.extensionSettings[SETTINGS_KEY];
    for (const [key, value] of Object.entries(DEFAULTS)) if (settings[key] === undefined) settings[key] = value;
    return settings;
}

function ensureStore(ctx) {
    if (!ctx?.chatMetadata) return null;
    if (!ctx.chatMetadata[METADATA_KEY] || typeof ctx.chatMetadata[METADATA_KEY] !== 'object') {
        ctx.chatMetadata[METADATA_KEY] = {};
    }
    const store = ctx.chatMetadata[METADATA_KEY];
    if (!store.hierarchical_summaries || typeof store.hierarchical_summaries !== 'object') {
        store.hierarchical_summaries = {
            version: 1,
            processed_turn_ids: [],
            consumed_l1_ids: [],
            consumed_l2_ids: [],
            level1: [],
            level2: [],
            level3: [],
            dirty: false,
            last_run_at: null,
            last_error: null,
        };
    }
    const tree = store.hierarchical_summaries;
    for (const key of ['processed_turn_ids', 'consumed_l1_ids', 'consumed_l2_ids', 'level1', 'level2', 'level3']) {
        if (!Array.isArray(tree[key])) tree[key] = [];
    }
    return tree;
}

function fnv1a32(value) {
    let hash = 0x811c9dc5;
    const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
}

function clean(value, max = 100000) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

export function collectCompletedDialogueTurns(chatInput) {
    const chat = Array.isArray(chatInput) ? chatInput : [];
    const turns = [];
    let userParts = [];
    for (let index = 0; index < chat.length; index++) {
        const row = chat[index];
        if (!row || row.is_system || !clean(row.mes)) continue;
        if (row.is_user) {
            userParts.push(clean(row.mes, 12000));
            continue;
        }
        const assistant = clean(row.mes, 16000);
        const user = clean(userParts.join('\n'), 16000);
        userParts = [];
        const source = `${user ? `用户：${user}\n` : ''}助手：${assistant}`;
        const fingerprint = fnv1a32(source).toString(36);
        turns.push({
            id: `turn_${index}_${fingerprint}`,
            assistant_index: index,
            fingerprint,
            text: source,
        });
    }
    return turns;
}

function normalizeCount(value, fallback, { allowZero = false } = {}) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(allowZero ? 0 : 1, Math.min(100, n));
}

function buildPrompt(level, items) {
    const source = items.map((item, index) => `【${index + 1}】${item.text}`).join('\n\n');
    if (level === 1) {
        return `你是长期叙事记忆系统的一级总结器。请压缩下面已经结束的对话轮次，只保留可用于未来连续性的事实：发生的事件、角色当前状态变化、关系变化、承诺/计划、获得或失去的物品、地点变化、明确知道的新信息。不要补充原文没有的推断，不要评价文风，不要复述无意义寒暄。输出简洁中文事实摘要，不要使用标题。\n\n${source}`;
    }
    if (level === 2) {
        return `你是长期叙事记忆系统的二级聚合器。下面是多条一级事实摘要。请去重并合并成更稳定的阶段摘要，保留时间顺序、因果关系、尚未解决的事项和重要状态变化。禁止创造新事实。输出简洁中文，不要使用标题。\n\n${source}`;
    }
    return `你是长期叙事记忆系统的三级长期压缩器。下面是多条阶段摘要。请进一步压缩为长期可检索的剧情骨架：保留关键人物、关系、重大事件、长期目标、持续状态、未解决冲突；删除已经被后续事实覆盖的细节和重复内容。禁止创造新事实。输出简洁中文，不要使用标题。\n\n${source}`;
}

async function getSharedModule() {
    if (!sharedModulePromise) sharedModulePromise = import('/scripts/extensions/shared.js').catch(() => null);
    return sharedModulePromise;
}

async function callSummaryModel(ctx, level, items) {
    const settings = ensureSettings(ctx);
    const prompt = buildPrompt(level, items);
    const maxTokens = Math.max(128, Math.min(4096, Number(settings.summary_max_tokens) || 600));

    if (settings.summary_provider_mode === 'connection_profile' && settings.summary_connection_profile_id) {
        const shared = await getSharedModule();
        const service = shared?.ConnectionManagerRequestService;
        if (!service) throw new Error('当前宿主未提供 Connection Manager Request Service。');
        const result = await service.sendRequest(
            settings.summary_connection_profile_id,
            [
                { role: 'system', content: '你只负责忠实压缩长期叙事记忆，不得续写剧情，不得创造新事实。' },
                { role: 'user', content: prompt },
            ],
            maxTokens,
            { stream: false, extractData: true, includePreset: false, includeInstruct: true },
            { temperature: 0.2 },
        );
        const content = clean(result?.content, 30000);
        if (!content) throw new Error('独立总结 Connection Profile 返回了空结果。');
        return content;
    }

    if (typeof ctx.generateQuietPrompt !== 'function') throw new Error('当前 SillyTavern Context 未提供 generateQuietPrompt。');
    // Reuse the existing quiet-extraction guard so the memory interceptor does not inject its own
    // context back into a summary request.
    settings.__quiet_extraction_in_progress = true;
    try {
        const result = await ctx.generateQuietPrompt({ quietPrompt: prompt });
        const content = clean(typeof result === 'string' ? result : result?.content, 30000);
        if (!content) throw new Error('当前主 API 返回了空总结。');
        return content;
    } finally {
        delete settings.__quiet_extraction_in_progress;
    }
}

function pushSummary(tree, level, sourceIds, text) {
    const id = `summary_l${level}_${fnv1a32(`${sourceIds.join('|')}|${text}`).toString(36)}`;
    const row = { id, level, source_ids: [...sourceIds], text: clean(text, 30000), created_at: Date.now() };
    tree[`level${level}`].push(row);
    return row;
}

export async function processSummaryHierarchy(ctxInput = getContext()) {
    const ctx = ctxInput;
    const settings = ensureSettings(ctx);
    const tree = ensureStore(ctx);
    if (!ctx || !settings || !tree || !settings.hierarchical_summary_enabled) return { skipped: 'disabled' };

    const turns = collectCompletedDialogueTurns(ctx.chat || []);
    const processed = new Set(tree.processed_turn_ids);
    let pendingTurns = turns.filter(turn => !processed.has(turn.id));
    const l1Every = normalizeCount(settings.summary_level1_every_turns, 1);
    const l2Every = normalizeCount(settings.summary_level2_every_l1, 3, { allowZero: true });
    const l3Every = normalizeCount(settings.summary_level3_every_l2, 3, { allowZero: true });
    let created = 0;

    while (pendingTurns.length >= l1Every) {
        const batch = pendingTurns.slice(0, l1Every);
        const text = await callSummaryModel(ctx, 1, batch);
        pushSummary(tree, 1, batch.map(x => x.id), text);
        tree.processed_turn_ids.push(...batch.map(x => x.id));
        pendingTurns = pendingTurns.slice(l1Every);
        created += 1;
    }

    if (l2Every > 0) {
        const consumed = new Set(tree.consumed_l1_ids);
        let available = tree.level1.filter(row => !consumed.has(row.id));
        while (available.length >= l2Every) {
            const batch = available.slice(0, l2Every);
            const text = await callSummaryModel(ctx, 2, batch);
            pushSummary(tree, 2, batch.map(x => x.id), text);
            tree.consumed_l1_ids.push(...batch.map(x => x.id));
            available = available.slice(l2Every);
            created += 1;
        }
    }

    if (l3Every > 0) {
        const consumed = new Set(tree.consumed_l2_ids);
        let available = tree.level2.filter(row => !consumed.has(row.id));
        while (available.length >= l3Every) {
            const batch = available.slice(0, l3Every);
            const text = await callSummaryModel(ctx, 3, batch);
            pushSummary(tree, 3, batch.map(x => x.id), text);
            tree.consumed_l2_ids.push(...batch.map(x => x.id));
            available = available.slice(l3Every);
            created += 1;
        }
    }

    tree.last_run_at = Date.now();
    tree.last_error = null;
    tree.dirty = false;
    ctx.saveMetadataDebounced?.();
    refreshSummaryPrompt(ctx);
    renderSummaryStatus(ctx);
    return { created, level1: tree.level1.length, level2: tree.level2.length, level3: tree.level3.length };
}

function formatSummaryContext(tree, maxChars) {
    if (!tree) return '';
    const blocks = [];
    const append = (label, rows) => {
        if (!rows.length) return;
        blocks.push(`${label}\n${rows.map(row => `- ${row.text}`).join('\n')}`);
    };
    append('[三级长期摘要]', tree.level3.slice(-2));
    append('[二级阶段摘要]', tree.level2.slice(-3));
    append('[一级近期摘要]', tree.level1.slice(-5));
    const text = blocks.join('\n\n');
    return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export function refreshSummaryPrompt(ctxInput = getContext()) {
    const ctx = ctxInput;
    const settings = ensureSettings(ctx);
    const tree = ensureStore(ctx);
    if (!ctx?.setExtensionPrompt || !settings) return false;
    if (!settings.hierarchical_summary_enabled) {
        ctx.setExtensionPrompt(SUMMARY_PROMPT_KEY, '', IN_CHAT, Number(settings.summary_injection_depth) || 4, false, SYSTEM_ROLE);
        return true;
    }
    const maxChars = Math.max(1000, Math.min(20000, Number(settings.summary_max_context_chars) || 6000));
    const body = formatSummaryContext(tree, maxChars);
    const block = body ? `[AETHERIA HIERARCHICAL STORY SUMMARY — DERIVED MEMORY]\n${body}` : '';
    ctx.setExtensionPrompt(SUMMARY_PROMPT_KEY, block, IN_CHAT, Math.max(0, Number(settings.summary_injection_depth) || 4), false, SYSTEM_ROLE);
    return true;
}

async function listProfiles() {
    const shared = await getSharedModule();
    try { return shared?.ConnectionManagerRequestService?.getSupportedProfiles?.() || []; } catch { return []; }
}

function getVectorInfo(ctx, settings) {
    const vectors = ctx?.extensionSettings?.vectors || {};
    const source = settings.vector_source_mode === 'transformers' ? 'transformers' : String(vectors.source || 'transformers');
    const modelKeys = {
        openai: 'openai_model', togetherai: 'togetherai_model', electronhub: 'electronhub_model', openrouter: 'openrouter_model',
        cohere: 'cohere_model', ollama: 'ollama_model', vllm: 'vllm_model', webllm: 'webllm_model', google: 'google_model',
        chutes: 'chutes_model', nanogpt: 'nanogpt_model', siliconflow: 'siliconflow_model', workers_ai: 'workers_ai_model',
    };
    const model = modelKeys[source] ? vectors[modelKeys[source]] : '';
    return { source, model: model || (source === 'transformers' ? 'Local Transformers（由 Vector Storage 管理）' : '由 Vector Storage 管理') };
}

async function mountSummaryUi(ctxInput = getContext()) {
    if (typeof document === 'undefined') return false;
    const ctx = ctxInput;
    const settings = ensureSettings(ctx);
    const page = document.getElementById('aum-v55-settings-page-memory') || document.querySelector('#aum-v54-settings .inline-drawer-content');
    if (!page || !settings) return false;
    let root = document.getElementById('aum-v55-summary-settings');
    if (!root) {
        root = document.createElement('section');
        root.id = 'aum-v55-summary-settings';
        root.className = 'aum-v54-section aum-v55-summary-settings';
        root.innerHTML = `
            <h4>分层自动总结与模型接口</h4>
            <p class="aum-v51-muted">每次助手回复完成后检查总结阈值。一级直接压缩对话轮次，二级聚合一级摘要，三级再压缩阶段摘要。API 密钥仍由 SillyTavern 管理，本插件只选择连接。</p>
            <label class="checkbox_label"><input id="aum-v55-summary-enabled" type="checkbox"> 启用分层自动总结</label>
            <div class="aum-v51-grid">
                <label>总结模型来源
                    <select id="aum-v55-summary-provider" class="text_pole">
                        <option value="current">当前 SillyTavern 主 API</option>
                        <option value="connection_profile">独立 Connection Profile</option>
                    </select>
                </label>
                <label>独立总结 Connection Profile
                    <select id="aum-v55-summary-profile" class="text_pole"></select>
                </label>
                <label>单次总结最大输出 tokens<input id="aum-v55-summary-max-tokens" class="text_pole" type="number" min="128" max="4096" step="64"></label>
                <label>一级：每多少轮完整对话总结一次<input id="aum-v55-summary-l1" class="text_pole" type="number" min="1" max="100" step="1"></label>
                <label>二级：每多少个一级摘要聚合一次<input id="aum-v55-summary-l2" class="text_pole" type="number" min="0" max="100" step="1"></label>
                <label>三级：每多少个二级摘要聚合一次<input id="aum-v55-summary-l3" class="text_pole" type="number" min="0" max="100" step="1"></label>
            </div>
            <small>把二级或三级设为 0 可关闭该层。这里的“一轮完整对话”以一次助手回复结束为边界，而不是等待整个聊天窗口关闭。</small>
            <div id="aum-v55-summary-api-status" class="aum-v51-status"></div>
            <div id="aum-v55-summary-vector-status" class="aum-v51-status"></div>
            <div class="aum-v51-buttons">
                <button id="aum-v55-summary-run" class="menu_button">立即检查并总结</button>
                <button id="aum-v55-summary-rebuild" class="menu_button">从当前聊天重建总结树</button>
                <button id="aum-v55-summary-refresh" class="menu_button">刷新接口状态</button>
            </div>
            <div id="aum-v55-summary-status" class="aum-v51-status">尚未生成分层摘要。</div>`;
        page.prepend(root);

        const bindSave = (id, key, parser = value => value) => {
            const el = root.querySelector(`#${id}`);
            el?.addEventListener('change', () => {
                settings[key] = parser(el.type === 'checkbox' ? el.checked : el.value);
                ctx.saveSettingsDebounced?.();
                renderSummaryStatus(ctx);
                refreshSummaryPrompt(ctx);
            });
        };
        bindSave('aum-v55-summary-enabled', 'hierarchical_summary_enabled', Boolean);
        bindSave('aum-v55-summary-provider', 'summary_provider_mode', String);
        bindSave('aum-v55-summary-profile', 'summary_connection_profile_id', String);
        bindSave('aum-v55-summary-max-tokens', 'summary_max_tokens', Number);
        bindSave('aum-v55-summary-l1', 'summary_level1_every_turns', Number);
        bindSave('aum-v55-summary-l2', 'summary_level2_every_l1', Number);
        bindSave('aum-v55-summary-l3', 'summary_level3_every_l2', Number);

        root.querySelector('#aum-v55-summary-run')?.addEventListener('click', () => scheduleSummaryCheck(0));
        root.querySelector('#aum-v55-summary-rebuild')?.addEventListener('click', () => {
            const tree = ensureStore(ctx);
            Object.assign(tree, { processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [], level1: [], level2: [], level3: [], dirty: false, last_error: null });
            ctx.saveMetadataDebounced?.();
            scheduleSummaryCheck(0);
        });
        root.querySelector('#aum-v55-summary-refresh')?.addEventListener('click', () => { void renderSummaryStatus(ctx); });
    }

    root.querySelector('#aum-v55-summary-enabled').checked = Boolean(settings.hierarchical_summary_enabled);
    root.querySelector('#aum-v55-summary-provider').value = settings.summary_provider_mode;
    root.querySelector('#aum-v55-summary-max-tokens').value = settings.summary_max_tokens;
    root.querySelector('#aum-v55-summary-l1').value = settings.summary_level1_every_turns;
    root.querySelector('#aum-v55-summary-l2').value = settings.summary_level2_every_l1;
    root.querySelector('#aum-v55-summary-l3').value = settings.summary_level3_every_l2;

    const profileEl = root.querySelector('#aum-v55-summary-profile');
    const profiles = await listProfiles();
    profileEl.replaceChildren();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = profiles.length ? '请选择 Connection Profile' : '没有可用的 Connection Profile';
    profileEl.append(empty);
    for (const profile of profiles) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.name}${profile.model ? ` · ${profile.model}` : ''}`;
        profileEl.append(option);
    }
    profileEl.value = settings.summary_connection_profile_id || '';
    profileEl.disabled = settings.summary_provider_mode !== 'connection_profile';
    void renderSummaryStatus(ctx);
    return true;
}

async function renderSummaryStatus(ctxInput = getContext()) {
    const ctx = ctxInput;
    const settings = ensureSettings(ctx);
    const tree = ensureStore(ctx);
    const root = document.getElementById('aum-v55-summary-settings');
    if (!root || !settings || !tree) return false;
    const profiles = await listProfiles();
    const selected = profiles.find(profile => profile.id === settings.summary_connection_profile_id);
    const apiStatus = settings.summary_provider_mode === 'connection_profile'
        ? (selected ? `总结 API：独立 Connection Profile「${selected.name}」${selected.model ? ` / ${selected.model}` : ''}` : '总结 API：已选择独立 Connection Profile，但当前未找到有效配置。')
        : '总结 API：继承当前 SillyTavern 主连接与当前模型。';
    root.querySelector('#aum-v55-summary-api-status').textContent = apiStatus;
    const vector = getVectorInfo(ctx, settings);
    root.querySelector('#aum-v55-summary-vector-status').textContent = `向量模型：${vector.source} / ${vector.model}。向量 API 与密钥由 SillyTavern Vector Storage / API Connections 管理，本插件不会另存密钥。`;
    root.querySelector('#aum-v55-summary-status').textContent = `一级摘要 ${tree.level1.length} ｜ 二级摘要 ${tree.level2.length} ｜ 三级摘要 ${tree.level3.length}${tree.dirty ? ' ｜ 历史已修改，摘要树待重建' : ''}${tree.last_error ? ` ｜ 最近错误：${tree.last_error}` : ''}`;
    const profileEl = root.querySelector('#aum-v55-summary-profile');
    if (profileEl) profileEl.disabled = settings.summary_provider_mode !== 'connection_profile';
    return true;
}

function enqueueSummary(task) {
    summaryQueue = summaryQueue.then(task, task).catch(error => {
        const ctx = getContext();
        const tree = ensureStore(ctx);
        if (tree) {
            tree.last_error = String(error?.message || error);
            ctx?.saveMetadataDebounced?.();
        }
        console.error('[Aetheria v5.5 Summary]', error);
        void renderSummaryStatus(ctx);
    });
    return summaryQueue;
}

function scheduleSummaryCheck(delay = 250) {
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => {
        scheduledTimer = null;
        void enqueueSummary(async () => {
            const ctx = getContext();
            if (!ctx) return;
            await processSummaryHierarchy(ctx);
        });
    }, Math.max(0, delay));
}

function markHistoryDirty() {
    const ctx = getContext();
    const settings = ensureSettings(ctx);
    const tree = ensureStore(ctx);
    if (!ctx || !tree || !settings) return;
    if (settings.summary_auto_rebuild_on_history_change) {
        Object.assign(tree, { processed_turn_ids: [], consumed_l1_ids: [], consumed_l2_ids: [], level1: [], level2: [], level3: [], dirty: false });
        scheduleSummaryCheck(300);
    } else {
        tree.dirty = true;
        ctx.saveMetadataDebounced?.();
        void renderSummaryStatus(ctx);
    }
}

export function installV55HierarchicalSummary() {
    const ctx = getContext();
    if (!ctx) return false;
    ensureSettings(ctx);
    ensureStore(ctx);
    void mountSummaryUi(ctx);
    refreshSummaryPrompt(ctx);

    if (!installed) {
        const events = ctx.eventTypes || {};
        const onIf = (event, handler) => { if (event && ctx.eventSource?.on) ctx.eventSource.on(event, handler); };
        const afterAssistant = () => scheduleSummaryCheck(350);
        onIf(events.MESSAGE_RECEIVED, afterAssistant);
        onIf(events.CHARACTER_MESSAGE_RENDERED, afterAssistant);
        onIf(events.CHAT_CHANGED, () => setTimeout(() => {
            const current = getContext();
            ensureStore(current);
            void mountSummaryUi(current);
            refreshSummaryPrompt(current);
            void renderSummaryStatus(current);
        }, 80));
        for (const event of [events.MESSAGE_SWIPED, events.MESSAGE_EDITED, events.MESSAGE_UPDATED, events.MESSAGE_DELETED]) onIf(event, markHistoryDirty);
        installed = true;
    }

    for (const delay of [150, 500, 1200, 2200]) setTimeout(() => { void mountSummaryUi(getContext()); }, delay);
    return true;
}
