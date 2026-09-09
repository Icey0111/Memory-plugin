// Aetheria Unified Memory v5.5 — host-facing UI polish/localization layer.
// Keeps runtime/data semantics untouched while presenting the dynamic v5.5 surfaces in Chinese.

let observer = null;
let scheduled = false;
const SECTION_STATE_PREFIX = 'aetheria-v55-section:';

const STATIC_TEXT = new Map([
    ['Plugin Setting Index + Retrieval · v5.5 Commit G', '设定索引与检索 · v5.5 Commit G'],
    ['Semantic Baseline Index', '语义基线索引'],
    ['Embedding source', '向量嵌入来源'],
    ['v5.5 Runtime diagnostics', 'v5.5 运行诊断'],
]);

const FRAGMENT_REPLACEMENTS = [
    ['Setting Store / Index', '设定库 / 索引'],
    ['Setting Store', '设定库'],
    ['Setting Index', '设定索引'],
    ['Setting Entry', '设定条目'],
    ['Semantic Baseline', '语义基线'],
    ['Reference Block', '参考区块'],
    ['Current State', '当前状态'],
    ['Canonical Memory', '规范记忆'],
    ['Embedding Profile', '嵌入配置'],
    ['Generation', '生成'],
    ['Extractor', '抽取器'],
    ['Dense', '向量'],
    ['Lexical', '词法'],
    ['World', '世界'],
];

function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
}

function translateText(value) {
    let out = String(value ?? '');
    for (const [from, to] of FRAGMENT_REPLACEMENTS) out = out.split(from).join(to);
    return out;
}

function replaceTextNodes(root) {
    if (!root || typeof document === 'undefined') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const raw = node.nodeValue || '';
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const exact = STATIC_TEXT.get(trimmed);
        const translated = exact || translateText(trimmed);
        if (translated === trimmed) continue;
        const leading = raw.match(/^\s*/)?.[0] || '';
        const trailing = raw.match(/\s*$/)?.[0] || '';
        node.nodeValue = `${leading}${translated}${trailing}`;
    }
}

function setControlLabel(controlId, text) {
    const control = document.getElementById(controlId);
    const label = control?.closest('label');
    if (!label) return;
    const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim());
    if (!textNode) return;
    const prefix = textNode.nodeValue.match(/^\s*/)?.[0] || '';
    const suffix = textNode.nodeValue.match(/\s*$/)?.[0] || '';
    const next = `${prefix}${text}${suffix}`;
    if (textNode.nodeValue !== next) textNode.nodeValue = next;
}

function translateOption(option) {
    const exact = {
        'No plugin world': '未选择插件世界',
        'No baseline': '无基线版本',
        'Baseline': '基线',
        'Extension': '扩展',
    };
    if (exact[option.textContent]) option.textContent = exact[option.textContent];
}

function translateBindingStatus(value) {
    const text = String(value || '').trim();
    if (text === 'No world pinned') return '未绑定世界';
    if (text === 'Pinned to current chat.') return '已绑定到当前聊天。';
    if (text.startsWith('Pinned: ')) return `已绑定：${text.slice(8).replace(/\/ none$/, '/ 无基线')}`;
    if (text.startsWith('Invalid binding: ')) return `绑定无效：${text.slice(17)}`;
    return translateText(text);
}

function translateEntryStatus(value) {
    const text = String(value || '').trim();
    if (text === 'No Entry selected.') return '未选择设定条目。';
    if (text === 'Using immutable imported Entry.') return '当前使用不可变的导入条目。';
    if (text.startsWith('Overlay active · ')) return `覆盖编辑已启用 · ${text.slice(17)}`;
    if (text.startsWith('Overlay saved.')) return '覆盖编辑已保存。下次设定索引同步或生成时会按同一作用域仅更新该条目；导入的来源 / 版本不会被改写。';
    if (text.startsWith('Overlay cleared;')) return '覆盖编辑已清除；重新使用不可变的导入条目。';
    return translateText(text);
}

function translateUntitledPreview(value) {
    let text = String(value || '');
    if (text === 'Untitled TXT segmentation preview appears here when needed.') return '无标题 TXT 分段预览会在需要时显示于此。';
    if (text === 'H1/H2 headings detected; normal heading segmentation will be used.') return '检测到 H1/H2 标题，将使用常规标题分段。';
    text = text.replace(/^Untitled TXT preview only · paragraph-preview · candidate segments (\d+)/m, '仅预览无标题 TXT · 按段落预览 · 候选分段 $1');
    text = text.replace(/^Untitled TXT preview only · sentence-preview · candidate segments (\d+)/m, '仅预览无标题 TXT · 按句子预览 · 候选分段 $1');
    text = text.replace('Import remains conservative (one Entry) unless the source is explicitly titled; this preview lets you inspect likely boundaries before editing the file.', '除非源文件具有明确标题，否则导入仍采用保守策略（单个条目）；此预览用于在编辑文件前检查可能的分段边界。');
    text = text.replace(/\[(\d+) chars\]/g, '[$1 字符]');
    return translateText(text);
}

function translateRuntimeStatus(value) {
    let text = translateText(value);
    text = text.replace(/Overlay/g, '覆盖编辑');
    text = text.replace(/向量 已就绪/g, '向量检索已就绪');
    text = text.replace(/向量 未就绪 \/ 词法可用/g, '向量检索未就绪 / 词法检索可用');
    return text;
}

function readSectionCollapsed(key, fallback = true) {
    try {
        const stored = globalThis.localStorage?.getItem(`${SECTION_STATE_PREFIX}${key}`);
        if (stored === '0') return false;
        if (stored === '1') return true;
    } catch { /* storage is optional */ }
    return fallback;
}

function writeSectionCollapsed(key, collapsed) {
    try { globalThis.localStorage?.setItem(`${SECTION_STATE_PREFIX}${key}`, collapsed ? '1' : '0'); } catch { /* storage is optional */ }
}

function setSectionCollapsed(root, key, collapsed) {
    if (!root) return;
    root.classList.toggle('aum-v55-section-collapsed', collapsed);
    const body = root.querySelector(':scope > .aum-v55-section-body');
    const toggle = root.querySelector(':scope > .aum-v55-section-header .aum-v55-section-toggle');
    if (body) body.hidden = collapsed;
    if (toggle) {
        toggle.textContent = collapsed ? '展开' : '收起';
        toggle.setAttribute('aria-expanded', String(!collapsed));
    }
    writeSectionCollapsed(key, collapsed);
}

function enhanceCollapsibleSection(root, key, summaryText, { defaultCollapsed = true } = {}) {
    if (!root) return null;
    root.classList.add('aum-v55-collapsible-section');
    let header = root.querySelector(':scope > .aum-v55-section-header');
    let body = root.querySelector(':scope > .aum-v55-section-body');
    if (!header || !body) {
        const title = root.querySelector(':scope > h4') || root.querySelector('h4');
        header = document.createElement('div');
        header.className = 'aum-v55-section-header';
        const titleWrap = document.createElement('div');
        titleWrap.className = 'aum-v55-section-title';
        if (title) titleWrap.append(title);
        const summary = document.createElement('span');
        summary.className = 'aum-v55-section-summary';
        titleWrap.append(summary);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'menu_button aum-v55-section-toggle';
        header.append(titleWrap, toggle);

        body = document.createElement('div');
        body.className = 'aum-v55-section-body';
        for (const child of [...root.children]) {
            if (child === header || child === body) continue;
            body.append(child);
        }
        root.prepend(header);
        root.append(body);
        toggle.addEventListener('click', event => {
            event.preventDefault();
            setSectionCollapsed(root, key, !root.classList.contains('aum-v55-section-collapsed'));
        });
        header.addEventListener('dblclick', event => {
            if (event.target.closest('button')) return;
            setSectionCollapsed(root, key, !root.classList.contains('aum-v55-section-collapsed'));
        });
        setSectionCollapsed(root, key, readSectionCollapsed(key, defaultCollapsed));
    }
    const summary = root.querySelector(':scope > .aum-v55-section-header .aum-v55-section-summary');
    if (summary) setText(summary, summaryText || '');
    return body;
}

function bindingSummary(root) {
    const status = translateBindingStatus(root?.querySelector('#aum-v55-binding-status')?.textContent || '');
    return status || '未绑定世界';
}

function updateEntryEmptyState(root) {
    if (!root) return;
    const select = root.querySelector('#aum-v55-entry-select');
    const hasEntry = Boolean(select?.value && select.options?.length);
    root.classList.toggle('aum-v55-entry-empty', !hasEntry);
    const summary = root.querySelector(':scope > .aum-v55-section-header .aum-v55-section-summary');
    if (summary) setText(summary, hasEntry ? `当前条目：${select.selectedOptions?.[0]?.textContent || select.value}` : '未选择条目，编辑表单已收起');
}

function ensurePageHelp(pageId, title, bodyHtml) {
    const page = document.getElementById(`aum-v55-settings-page-${pageId}`);
    if (!page || page.querySelector(':scope > .aum-v55-page-help')) return;
    const box = document.createElement('section');
    box.className = 'aum-v55-page-help';
    box.innerHTML = `<h4>${title}</h4>${bodyHtml}`;
    page.prepend(box);
}

function mountPageExplanations() {
    ensurePageHelp('settings', '“设定”页是做什么的？', `
        <p><strong>设定 = 故事开始前就已经存在的世界资料。</strong>例如国家、城市、组织、角色档案、地点规则、世界观条目等。</p>
        <ul>
            <li><strong>导入设定库：</strong>把 JSON / TXT 世界书变成插件自己的结构化设定资料。</li>
            <li><strong>聊天设定绑定：</strong>指定当前聊天使用哪一个世界、哪一版基线，以及叠加哪些扩展版本。</li>
            <li><strong>设定索引 / 检索：</strong>当聊天需要某条世界设定时，只找相关条目放进上下文，不必每轮把整本世界书都塞给模型。</li>
            <li><strong>条目覆盖编辑：</strong>临时修正某个设定条目，同时保留原始导入版本不变。</li>
        </ul>
        <p>一句话：<strong>设定页负责“世界本来是什么样”。</strong></p>`);

    ensurePageHelp('baseline', '“基线”页是做什么的？', `
        <p><strong>基线 = 用来判断“这是不是已经知道的固定事实”的参照层。</strong>它主要防止自动记忆把角色卡、Persona、世界书里本来就存在的资料反复记成新的剧情事件。</p>
        <ul>
            <li>例如角色卡已经写着“平成住在东京”，聊天里再次提到东京时，不需要再新增一条“平成住在东京”的剧情记忆。</li>
            <li>但“平成今天第一次得知某个秘密”属于新发生的剧情信息，仍然可以进入记忆。</li>
            <li><strong>词法过滤</strong>负责发现文字很接近的重复；<strong>语义向量复核</strong>负责发现换了说法但意思相同的重复。</li>
        </ul>
        <p>一句话：<strong>基线页负责区分“原本就知道”与“剧情中新发生/新知道”。</strong></p>`);
}

function localizeBinding(root) {
    if (!root) return;
    setText(root.querySelector('h4'), 'v5.5 聊天设定绑定');
    setControlLabel('aum-v55-binding-world', '世界');
    setControlLabel('aum-v55-binding-baseline', '基线版本');
    setControlLabel('aum-v55-binding-extensions', '扩展版本');
    setText(root.querySelector('#aum-v55-binding-pin'), '绑定到当前聊天');
    root.querySelectorAll('option').forEach(translateOption);
    const ext = root.querySelector('#aum-v55-binding-extensions');
    if (ext) ext.size = 3;
    const status = root.querySelector('#aum-v55-binding-status');
    if (status) setText(status, translateBindingStatus(status.textContent));
    enhanceCollapsibleSection(root, 'binding', bindingSummary(root), { defaultCollapsed: true });
}

function localizeEntryEditor(root) {
    if (!root) return;
    setText(root.querySelector('h4'), 'v5.5 设定条目覆盖编辑');
    const description = root.querySelector('small');
    if (description) setText(description, '导入的来源 / 版本保持不可变。编辑内容作为同一版本作用域下的覆盖层保存，因此下一次索引同步时只需要更新发生变化的条目。');
    setControlLabel('aum-v55-entry-select', '条目');
    setControlLabel('aum-v55-entry-title', '标题');
    setControlLabel('aum-v55-entry-keys', '主关键词');
    setControlLabel('aum-v55-entry-secondary', '次关键词');
    setControlLabel('aum-v55-entry-order', '排序');
    setControlLabel('aum-v55-entry-content', '内容');
    setControlLabel('aum-v55-entry-constant', '常驻 / 核心设定');
    setControlLabel('aum-v55-entry-disabled', '禁用');
    const keys = root.querySelector('#aum-v55-entry-keys');
    const secondary = root.querySelector('#aum-v55-entry-secondary');
    if (keys) keys.placeholder = '用逗号分隔';
    if (secondary) secondary.placeholder = '用逗号分隔';
    const textarea = root.querySelector('#aum-v55-entry-content');
    if (textarea) textarea.rows = 5;
    setText(root.querySelector('#aum-v55-entry-save'), '保存覆盖编辑');
    setText(root.querySelector('#aum-v55-entry-clear'), '清除覆盖编辑');
    const status = root.querySelector('#aum-v55-entry-status');
    if (status) setText(status, translateEntryStatus(status.textContent));

    const editControls = [
        '#aum-v55-entry-title', '#aum-v55-entry-keys', '#aum-v55-entry-secondary', '#aum-v55-entry-order',
        '#aum-v55-entry-content', '#aum-v55-entry-constant', '#aum-v55-entry-disabled',
    ];
    for (const selector of editControls) root.querySelector(selector)?.closest('label')?.classList.add('aum-v55-entry-edit-field');
    root.querySelector('#aum-v55-entry-save')?.closest('.aum-v51-buttons')?.classList.add('aum-v55-entry-actions');

    enhanceCollapsibleSection(root, 'entry-overlay', '', { defaultCollapsed: true });
    updateEntryEmptyState(root);
}

function localizeStaticControls(root) {
    replaceTextNodes(root);
    const revisionKind = document.getElementById('aum-v54-setting-revision-kind');
    revisionKind?.querySelectorAll('option').forEach(translateOption);
    const runtimeSummary = document.getElementById('aum-v55-runtime-summary');
    if (runtimeSummary) setText(runtimeSummary, translateRuntimeStatus(runtimeSummary.textContent));
    const runtimeDiag = document.querySelector('#aum-v55-runtime-dashboard summary');
    if (runtimeDiag) setText(runtimeDiag, 'v5.5 运行诊断');
    const untitled = document.getElementById('aum-v55-untitled-preview');
    if (untitled) setText(untitled, translateUntitledPreview(untitled.textContent));
}

export function localizeV55Ui() {
    if (typeof document === 'undefined') return false;
    const root = document.getElementById('aum-v54-settings');
    if (!root) return false;
    localizeStaticControls(root);
    localizeBinding(document.getElementById('aum-v55-chat-binding'));
    localizeEntryEditor(document.getElementById('aum-v55-entry-editor'));
    mountPageExplanations();
    return true;
}

function scheduleLocalization() {
    if (scheduled) return;
    scheduled = true;
    const run = () => {
        scheduled = false;
        localizeV55Ui();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
}

export function installV55UiPolish() {
    if (typeof document === 'undefined') return false;
    localizeV55Ui();
    const root = document.getElementById('aum-v54-settings');
    if (!root) return false;
    if (!observer && typeof MutationObserver === 'function') {
        observer = new MutationObserver(scheduleLocalization);
        observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['value', 'selected'] });
    }
    return true;
}
