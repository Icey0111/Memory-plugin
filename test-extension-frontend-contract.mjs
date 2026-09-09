import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
    return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

const manifest = JSON.parse(read('./manifest.json'));
assert.equal(manifest.js, 'index-v55-bootstrap.js');
assert.equal(manifest.hooks?.activate, 'init');
assert.deepEqual(manifest.dependencies, [], 'Vector Storage must not hard-block extension activation.');
assert.deepEqual(manifest.optional, [], 'manifest.optional is reserved for Extras modules, not optional extensions.');

const bootstrap = read('./index-v55-bootstrap.js');
assert.match(bootstrap, /index-v55\.js/, 'bootstrap must keep the v5.5 staged core entry point');
assert.match(bootstrap, /v55-ui-polish\.js/, 'bootstrap must install the host-facing UI localization layer');

const entry = read('./index-v55.js');
assert.match(entry, /\/scripts\/extensions\//, 'entry point must resolve its installed extension path dynamically');
assert.match(entry, /LEGACY_EXTENSION_PATH/, 'entry point must preserve legacy template-path compatibility');
assert.match(entry, /aum-v55-runtime-dashboard/, 'v5.5 runtime dashboard must be mounted');
assert.match(entry, /aum-v55-chat-binding/, 'UI normalizer must recognize the chat binding surface');
assert.match(entry, /aum-v55-entry-editor/, 'UI normalizer must recognize the setting overlay editor');
assert.match(entry, /buildSceneSummaries/, 'runtime dashboard must expose rebuildable scene-summary visibility');
assert.match(entry, /aum-v55-settings-window/, 'settings must be converted into a bounded secondary window');
assert.match(entry, /SETTINGS_PAGES/, 'settings must expose paged navigation');
assert.match(entry, /aum-v55-settings-tabs/, 'settings pagination must expose a tab navigation surface');
assert.match(entry, /ResizeObserver/, 'layout must react to the actual extension drawer width');

const polish = read('./v55-ui-polish.js');
assert.match(polish, /v5\.5 聊天设定绑定/, 'dynamic chat-binding UI must be localized');
assert.match(polish, /v5\.5 设定条目覆盖编辑/, 'dynamic entry-overlay UI must be localized');
assert.match(polish, /未绑定世界/, 'dynamic empty binding state must be localized');
assert.match(polish, /无标题 TXT 分段预览/, 'untitled TXT preview must be localized');

const settings = read('./settings.html');
for (const id of [
    'aum-v54-settings',
    'aum-v54-enabled',
    'aum-v54-auto-extract',
    'aum-v54-setting-file',
    'aum-v54-setting-commit',
    'aum-v54-rebuild-setting-index',
    'aum-v54-baseline-gate',
    'aum-v54-rebuild-baseline',
    'aum-v54-vector',
    'aum-v54-status',
    'aum-v54-diagnostics',
]) {
    assert.ok(settings.includes(`id="${id}"`), `settings.html missing required frontend control: ${id}`);
}

const style = read('./style.css');
assert.match(style, /aum-v55-brand-icon/);
assert.match(style, /aum-v55-runtime-dashboard/);
assert.match(style, /aum-v54-section/);
assert.match(style, /aum-v55-settings-window/);
assert.match(style, /height:\s*clamp\(/, 'secondary settings window must have a bounded responsive height');
assert.match(style, /overflow-y:\s*auto/, 'paged settings viewport must scroll internally');
assert.match(style, /writing-mode:\s*horizontal-tb/, 'button labels must stay horizontal');
assert.match(style, /word-break:\s*keep-all/, 'normal-width buttons must not break into vertical single-character columns');
assert.match(style, /aum-v55-compact/, 'narrow drawer layout must collapse grids/buttons deliberately');
assert.match(style, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'top tabs must wrap into a fixed grid instead of horizontal scrolling');
assert.doesNotMatch(style, /\.aum-v55-settings-tabs[\s\S]{0,400}overflow-x:\s*auto/, 'top tab bar must not create a horizontal scrollbar');

console.log('extension frontend contract tests passed');
