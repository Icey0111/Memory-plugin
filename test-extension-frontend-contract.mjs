import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
    return fs.readFileSync(new URL(path, import.meta.url), 'utf8');
}

const manifest = JSON.parse(read('./manifest.json'));
assert.equal(manifest.js, 'index-v55.js');
assert.equal(manifest.hooks?.activate, 'init');
assert.deepEqual(manifest.dependencies, [], 'Vector Storage must not hard-block extension activation.');
assert.deepEqual(manifest.optional, [], 'manifest.optional is reserved for Extras modules, not optional extensions.');

const entry = read('./index-v55.js');
assert.match(entry, /\/scripts\/extensions\//, 'entry point must resolve its installed extension path dynamically');
assert.match(entry, /LEGACY_EXTENSION_PATH/, 'entry point must preserve legacy template-path compatibility');
assert.match(entry, /aum-v55-runtime-dashboard/, 'v5.5 runtime dashboard must be mounted');
assert.match(entry, /aum-v55-chat-binding/, 'UI normalizer must recognize the chat binding surface');
assert.match(entry, /aum-v55-entry-editor/, 'UI normalizer must recognize the setting overlay editor');
assert.match(entry, /buildSceneSummaries/, 'runtime dashboard must expose rebuildable scene-summary visibility');

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

console.log('extension frontend contract tests passed');
