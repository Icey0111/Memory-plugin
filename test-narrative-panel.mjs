// The settings panel mount, which no offline test covered until a live run found the panel was never
// attached: parent.prepend had been moved into the renderer, where the only 'parent' in scope is the
// browser's window.parent. The failure was invisible offline (no document in Node) and loud in the app.
//
// The stub below deliberately reproduces the trap: globalThis.parent exists and has no prepend.
import assert from 'node:assert/strict';

const registry = new Map();
function fakeElement(tag = 'div') {
    const node = {
        tagName: String(tag).toUpperCase(), children: [], dataset: {}, style: {}, hidden: false,
        textContent: '', type: tag === 'input' ? 'number' : '', checked: false, value: '',
        addEventListener() {}, setAttribute() {}, removeAttribute() {},
        prepend(child) { node.children.unshift(child); child.parentElement = node; },
        append(child) { node.children.push(child); child.parentElement = node; },
        querySelector() { return fakeElement('input'); },
        querySelectorAll() { return [fakeElement('input'), fakeElement('input')]; },
    };
    Object.defineProperty(node, 'id', {
        get: () => node._id || '',
        set: value => { node._id = value; registry.set(value, node); },
    });
    Object.defineProperty(node, 'innerHTML', { get: () => node._html || '', set: value => { node._html = value; } });
    return node;
}

const parentNode = fakeElement('section');
registry.set('aum-v54-settings', parentNode);
globalThis.parent = { name: 'the browser window, which has no prepend' };
globalThis.document = {
    getElementById: id => registry.get(id) || null,
    querySelector: () => null,
    createElement: tag => fakeElement(tag),
    addEventListener() {},
};

const { mountNarrativeSettings, readNarrativeReport, narrativeSettings, anchorPanelText } = await import('./narrative-runtime.js?panel');

const ctx = {
    extensionSettings: { aetheriaUnifiedMemoryV54: { enabled: true, narrative_every: 7 } },
    chatMetadata: { aetheriaUnifiedMemoryV54: {} },
    chat: [],
};
const services = () => ({ isCurrent: () => true, vector: () => ({ supported: false, reason: 'test' }) });

// 1. the mount attaches the panel, and does not throw
let mounted = true;
try { mountNarrativeSettings(() => ctx, services); } catch (error) { mounted = false; }
assert.equal(mounted, true, 'mounting the panel must not throw');
const panel = registry.get('aum-narrative-settings');
assert.ok(panel, 'the panel is created');
assert.equal(parentNode.children.includes(panel), true, 'and attached to the settings page, not left floating');
assert.equal(narrativeSettings(ctx).narrative_every, 7, 'the reader fills missing defaults without overwriting');

// 2. the panel is filled from the read-only report, which creates no state
const report = JSON.parse(panel.querySelector('[data-status]') ? JSON.stringify(readNarrativeReport(ctx)) : '{}');
// A floor is what a reader of the chat counts: one user message and the character reply. The setting, the
// reported cadence and the hidden count are all in that unit, and messages are the derived number.
assert.equal(report.update_every_floors, 7, 'the setting and the reported cadence share one unit');
assert.equal(report.update_every_user_turns, 7, 'which is also the user turn');
assert.equal(report.update_every_messages, 14, 'and two message rows');
assert.equal('raw_history' in ctx.chatMetadata.aetheriaUnifiedMemoryV54, false,
    'a panel render must not create the archive, a summary or a fold audit');

// 3. a second mount is a no-op rather than a duplicate panel
const before = parentNode.children.length;
mountNarrativeSettings(() => ctx, services);
assert.equal(parentNode.children.length, before, 'an existing panel is not mounted twice');

// 4. the ledger line names parked records and keeps "unresolvable" apart from "not carried".
// Both conditions were recorded in the report and neither was on the panel: a count with no names cannot be
// acted on, and a live statement with no subject is a different defect from one with no carrier - the first
// cannot be resolved by anything, the second merely was not restated.
{
    const line = anchorPanelText({
        anchors_active: 12, anchors_injected: 9, anchors_parked: 3,
        anchors_parked_terms: [{ kind: '知道', text: '薇斯珀/知道' }, { kind: '知道', text: '灰袍老者/知道' },
            { kind: '知道', text: '南线/知道' }, { kind: '知道', text: '第四条/知道' }],
        anchors_superseded: 2, anchors_superseded_limit: 20,
        knowledge_entries: 4, knowledge_injected: 2, knowledge_parked: 2,
        knowledge_parked_terms: ['瑟拉菲娜/不知道', '灰袍老者/知道'],
        required_none: 1, required_total: 14, anchors_without_subject: 2 });
    assert.ok(line.includes('搁置 3：知道／薇斯珀/知道、知道／灰袍老者/知道、知道／南线/知道 等 4 项'),
        'parked anchors are named, bounded and still counted: ' + line);
    assert.ok(line.includes('搁置 2：瑟拉菲娜/不知道、灰袍老者/知道'), 'parked knowledge entries are named too');
    const long = anchorPanelText({ anchors_active: 1, anchors_injected: 1, anchors_parked: 1,
        anchors_parked_terms: [{ kind: '角色', text: '薇斯珀仍话少直接；她数夜听声、守前半夜，同意南线与炭窑洼守候' }],
        anchors_superseded: 0, anchors_superseded_limit: 20, knowledge_entries: 0, knowledge_injected: 0 });
    assert.ok(long.includes('角色／薇斯珀仍话少直接；她数夜听声、守前半夜…'), 'a named record is cut to a recognisable length: ' + long);
    assert.ok(!long.includes('炭窑洼守候'), 'and the whole statement is not pasted into the line');
    assert.ok(line.includes('无主体的活陈述 2 条'), 'an unresolvable statement is stated');
    assert.ok(line.includes('没有任何载体的活陈述 1 条'), 'and is not confused with one that has no carrier');
    const bare = anchorPanelText({ anchors_active: 1, anchors_injected: 1, anchors_superseded: 0,
        anchors_superseded_limit: 20, knowledge_entries: 0, knowledge_injected: 0 });
    assert.ok(!bare.includes('搁置'), 'nothing parked, no parked clause');
    assert.ok(!bare.includes('无主体'), 'and no unresolvable clause');
}

console.log('PASS narrative panel: the settings panel attaches, fills from the read-only report, mounts once, and names what it parked');
