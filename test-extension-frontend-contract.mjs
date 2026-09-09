import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) { return fs.readFileSync(new URL(path, import.meta.url), 'utf8'); }

const manifest = JSON.parse(read('./manifest.json'));
assert.equal(manifest.js, 'index-v55-bootstrap.js');
assert.equal(manifest.hooks?.activate, 'init');
assert.deepEqual(manifest.dependencies, []);
assert.deepEqual(manifest.optional, []);

const bootstrap = read('./index-v55-bootstrap.js');
assert.match(bootstrap, /index-v55\.js/);
assert.match(bootstrap, /v55-ui-polish\.js/);
assert.match(bootstrap, /v55-summary-runtime\.js/);
assert.match(bootstrap, /v55-api-connections\.js/, 'bootstrap must install independent API connection settings');

const entry = read('./index-v55.js');
assert.match(entry, /\/scripts\/extensions\//);
assert.match(entry, /LEGACY_EXTENSION_PATH/);
assert.match(entry, /aum-v55-runtime-dashboard/);
assert.match(entry, /aum-v55-chat-binding/);
assert.match(entry, /aum-v55-entry-editor/);
assert.match(entry, /buildSceneSummaries/);
assert.match(entry, /aum-v55-settings-window/);
assert.match(entry, /SETTINGS_PAGES/);
assert.match(entry, /aum-v55-settings-tabs/);
assert.match(entry, /ResizeObserver/);

const polish = read('./v55-ui-polish.js');
assert.match(polish, /v5\.5 聊天设定绑定/);
assert.match(polish, /v5\.5 设定条目覆盖编辑/);
assert.match(polish, /未绑定世界/);
assert.match(polish, /无标题 TXT 分段预览/);
assert.match(polish, /enhanceCollapsibleSection/);
assert.match(polish, /aum-v55-entry-empty/);
assert.match(polish, /textarea\.rows\s*=\s*5/);
assert.match(polish, /ext\.size\s*=\s*3/);
assert.match(polish, /SECTION_STATE_PREFIX/);
assert.match(polish, /“设定”页是做什么的？/);
assert.match(polish, /“基线”页是做什么的？/);
assert.match(polish, /世界本来是什么样/);
assert.match(polish, /原本就知道.*剧情中新发生\/新知道/s);

const summary = read('./v55-summary-runtime.js');
assert.match(summary, /分层自动总结与模型接口/);
assert.match(summary, /summary_level1_every_turns/);
assert.match(summary, /summary_level2_every_l1/);
assert.match(summary, /summary_level3_every_l2/);
assert.match(summary, /ConnectionManagerRequestService/);
assert.match(summary, /constructPrompt/);
assert.match(summary, /generateQuietPrompt/);
assert.match(summary, /CHARACTER_MESSAGE_RENDERED|MESSAGE_RECEIVED/);
assert.match(summary, /tree\.dirty/);

const api = read('./v55-api-connections.js');
assert.match(api, /独立 API 连接/);
assert.match(api, /OpenAI 兼容/);
assert.match(api, /aum-v55-summary-direct-url/);
assert.match(api, /aum-v55-summary-direct-key/);
assert.match(api, /aum-v55-summary-direct-model/);
assert.match(api, /aum-v55-vector-direct-url/);
assert.match(api, /aum-v55-vector-direct-key/);
assert.match(api, /aum-v55-vector-direct-model/);
assert.match(api, /chat-completions\/status/, 'connections must test through the SillyTavern server proxy');
assert.match(api, /writeSecret/, 'API keys must use SillyTavern Secret Store');
assert.match(api, /summary_connection_profile_id/, 'direct summary API must feed the summary runtime');
assert.match(api, /SECRET_KEYS/, 'direct API credentials must be mapped into host secret namespaces');
assert.match(api, /saveSecret\('VLLM'/, 'independent vector credentials must feed ST vLLM embedding transport');
assert.match(api, /vectors\.source\s*=\s*'vllm'/, 'direct vector mode must activate the OpenAI-compatible vLLM vector adapter');
assert.match(api, /vectors\.use_alt_endpoint\s*=\s*true/, 'direct vector mode must use its own endpoint instead of the host text endpoint');
assert.match(api, /vectors\.alt_endpoint_url\s*=\s*url/, 'direct vector endpoint must be projected into Vector Storage');
assert.match(api, /vectors\.vllm_model\s*=\s*model/, 'selected embedding model must be projected into Vector Storage');
assert.match(api, /probeDirectVectorTransport/, 'independent vector API must support a real embedding write/query probe');
assert.match(api, /aum-v55-vector-direct-test/, 'UI must expose an explicit embedding connectivity test');
assert.match(api, /Memory \/ Baseline \/ Setting Dense transport/, 'UI must explain which dense pipelines the vector API controls');

const settings = read('./settings.html');
for (const id of ['aum-v54-settings','aum-v54-enabled','aum-v54-auto-extract','aum-v54-setting-file','aum-v54-setting-commit','aum-v54-rebuild-setting-index','aum-v54-baseline-gate','aum-v54-rebuild-baseline','aum-v54-vector','aum-v54-status','aum-v54-diagnostics']) {
    assert.ok(settings.includes(`id="${id}"`), `settings.html missing required frontend control: ${id}`);
}

const style = read('./style.css');
assert.match(style, /aum-v55-brand-icon/);
assert.match(style, /aum-v55-runtime-dashboard/);
assert.match(style, /aum-v54-section/);
assert.match(style, /aum-v55-settings-window/);
assert.match(style, /height:\s*clamp\(/);
assert.match(style, /overflow-y:\s*auto/);
assert.match(style, /writing-mode:\s*horizontal-tb/);
assert.match(style, /word-break:\s*keep-all/);
assert.match(style, /aum-v55-compact/);
assert.match(style, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
assert.doesNotMatch(style, /\.aum-v55-settings-tabs[\s\S]{0,400}overflow-x:\s*auto/);
assert.match(style, /aum-v55-collapsible-section/);
assert.match(style, /aum-v55-section-body\[hidden\]/);
assert.match(style, /aum-v55-entry-editor\.aum-v55-entry-empty/);
assert.match(style, /#aum-v55-binding-pin[\s\S]*writing-mode:\s*horizontal-tb\s*!important/s);
assert.match(style, /#aum-v55-binding-pin[\s\S]*white-space:\s*nowrap\s*!important/s);
assert.match(style, /aum-v55-page-help/);
assert.match(style, /aum-v55-direct-api-settings/);

console.log('extension frontend contract tests passed');
