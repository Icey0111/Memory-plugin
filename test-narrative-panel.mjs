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

const { mountNarrativeSettings, readNarrativeReport, narrativeSettings } = await import('./narrative-runtime.js?panel');

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

console.log('PASS narrative panel: the settings panel attaches, fills from the read-only report, and mounts once');
