// Aetheria Unified Memory v5.5 — host-facing UI polish/localization layer.
// Keeps runtime/data semantics untouched while presenting the dynamic v5.5 surfaces in Chinese.

let observer = null;
let scheduled = false;

const STATIC_TEXT = new Map([
    ['Plugin Setting Index + Retrieval · v5.5 Commit G', '设定索引与检索 · v5.5 Commit G'],
    ['Semantic Baseline Index', '语义基线索引'],
    ['Embedding source', '向量嵌入来源'],
    ['v5.5 Runtime diagnostics', 'v5.5 运行诊断'],
]);

function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
}

function replaceExactTextNodes(root) {
    if (!root || typeof document === 'undefined') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
        const value = node.nodeValue?.trim();
        if (!value || !STATIC_TEXT.has(value)) continue;
        const replacement = STATIC_TEXT.get(value);
        const leading = node.nodeValue.match(/^\s*/)?.[0] || '';
        const trailing = node.nodeValue.match(/\s*$/)?.[0] || '';
        node.nodeValue = `${leading}${replacement}${trailing}`;
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
    return text;
}

function translateEntryStatus(value) {
    const text = String(value || '').trim();
    if (text === 'No Entry selected.') return '未选择设定条目。';
    if (text === 'Using immutable imported Entry.') return '当前使用不可变的导入条目。';
    if (text.startsWith('Overlay active · ')) return `覆盖编辑已启用 · ${text.slice(17)}`;
    if (text.startsWith('Overlay saved.')) return '覆盖编辑已保存。下次设定索引同步或生成时会按同一作用域仅更新该条目；导入的 Source / Revision 不会被改写。';
    if (text.startsWith('Overlay cleared;')) return '覆盖编辑已清除；重新使用不可变的导入条目。';
    return text;
}

function translateUntitledPreview(value) {
    let text = String(value || '');
    if (text === 'Untitled TXT segmentation preview appears here when needed.') return '无标题 TXT 分段预览会在需要时显示于此。';
    if (text === 'H1/H2 headings detected; normal heading segmentation will be used.') return '检测到 H1/H2 标题，将使用常规标题分段。';
    text = text.replace(/^Untitled TXT preview only · paragraph-preview · candidate segments (\d+)/m, '仅预览无标题 TXT · 按段落预览 · 候选分段 $1');
    text = text.replace(/^Untitled TXT preview only · sentence-preview · candidate segments (\d+)/m, '仅预览无标题 TXT · 按句子预览 · 候选分段 $1');
    text = text.replace('Import remains conservative (one Entry) unless the source is explicitly titled; this preview lets you inspect likely boundaries before editing the file.', '除非源文件具有明确标题，否则导入仍采用保守策略（单个条目）；此预览用于在编辑文件前检查可能的分段边界。');
    text = text.replace(/\[(\d+) chars\]/g, '[$1 字符]');
    return text;
}

function translateRuntimeStatus(value) {
    let text = String(value || '');
    text = text.replace(/\bWorld\b/g, '世界');
    text = text.replace(/\bOverlay\b/g, '覆盖编辑');
    text = text.replace(/Dense 已就绪/g, '向量检索已就绪');
    text = text.replace(/Dense 未就绪 \/ 词法可用/g, '向量检索未就绪 / 词法检索可用');
    return text;
}

function localizeBinding(root) {
    if (!root) return;
    setText(root.querySelector('h4'), 'v5.5 聊天设定绑定');
    setControlLabel('aum-v55-binding-world', '世界');
    setControlLabel('aum-v55-binding-baseline', '基线版本');
    setControlLabel('aum-v55-binding-extensions', '扩展版本');
    setText(root.querySelector('#aum-v55-binding-pin'), '绑定到当前聊天');
    root.querySelectorAll('option').forEach(translateOption);
    const status = root.querySelector('#aum-v55-binding-status');
    if (status) setText(status, translateBindingStatus(status.textContent));
}

function localizeEntryEditor(root) {
    if (!root) return;
    setText(root.querySelector('h4'), 'v5.5 设定条目覆盖编辑');
    const description = root.querySelector('small');
    if (description) setText(description, '导入的 Source / Revision 保持不可变。编辑内容作为同一版本作用域下的覆盖层保存，因此下一次索引同步时只需要更新发生变化的条目。');
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
    setText(root.querySelector('#aum-v55-entry-save'), '保存覆盖编辑');
    setText(root.querySelector('#aum-v55-entry-clear'), '清除覆盖编辑');
    const status = root.querySelector('#aum-v55-entry-status');
    if (status) setText(status, translateEntryStatus(status.textContent));
}

function localizeStaticControls(root) {
    replaceExactTextNodes(root);
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
        observer.observe(root, { childList: true, subtree: true, characterData: true });
    }
    return true;
}
