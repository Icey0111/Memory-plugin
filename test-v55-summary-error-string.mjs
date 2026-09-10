// A failed host generation resolves with a short error string rather than throwing: SillyTavern returns
// "[API 错误]\nToo many requests: ... status 429: AGY quota exhausted for requested model". Accepting
// that as a summary stored the provider's error text in the tree and permanently marked the batch as
// summarized, so the floor was folded with an error message standing in for it.
import assert from 'node:assert/strict';

const KEY = 'aetheriaUnifiedMemoryV54';
const ERROR_TEXT = '[API 错误]\nToo many requests: Custom OpenAI endpoint failed with status 429: AGY quota exhausted for requested model';
const chat = [];
for (let i = 0; i < 12; i++) {
  chat.push({ is_user: true, mes: `用户第${i + 1}层` });
  chat.push({ is_user: false, mes: `助手第${i + 1}层回复` });
}
const settings = {
  enabled: true, hierarchical_summary_enabled: true, summary_auto_rebuild_on_history_change: true,
  summary_provider_mode: 'current', summary_max_tokens: 512, summary_injection_depth: 4,
  summary_level1_every_turns: 10, summary_level2_every_l1: 2, summary_level3_every_l2: 2,
  summary_max_context_chars: 9000, summary_source_max_chars: 24000,
  summary_fold_hidden_floors: true, summary_fold_keep_recent_floors: 1,
};
function makeCtx(reply) {
  return {
    extensionSettings: { [KEY]: { ...settings } },
    chatMetadata: { [KEY]: {} },
    chat: chat.map(row => ({ ...row })),
    setExtensionPrompt: () => {}, saveMetadataDebounced: () => {}, saveSettingsDebounced: () => {}, saveChat: () => {},
    generateQuietPrompt: async () => (typeof reply === 'function' ? reply() : reply),
  };
}

const mod = await import('./v55-summary-runtime.js?error-string');

// The provider error must reject and leave the batch unsummarized so the next pass retries it.
const badCtx = makeCtx(ERROR_TEXT);
globalThis.SillyTavern = { getContext: () => badCtx };
await assert.rejects(() => mod.processSummaryHierarchy(badCtx), /返回错误而不是摘要/, 'a provider error string must not be accepted as a summary');
const badTree = badCtx.chatMetadata[KEY].hierarchical_summaries ?? {};
assert.equal((badTree.level1 ?? []).length, 0, 'no summary may be stored for a failed batch');
assert.equal((badTree.processed_turn_ids ?? []).length, 0, 'a failed batch must stay pending');
assert.equal(Object.keys(badCtx.chatMetadata[KEY].floor_folds?.hidden ?? {}).length, 0, 'nothing may be folded with an error standing in for it');

// A short but legitimate summary is still accepted, so the guard is about the error shape, not length.
const goodCtx = makeCtx('灰烬港爆发灰咳，源头是城西古井。');
globalThis.SillyTavern = { getContext: () => goodCtx };
const good = await mod.processSummaryHierarchy(goodCtx);
assert.equal(good.created, 1);
const goodTree = goodCtx.chatMetadata[KEY].hierarchical_summaries;
assert.equal(goodTree.level1.length, 1);
assert.match(goodTree.level1[0].text, /灰咳/);
assert.equal(goodTree.processed_turn_ids.length, 10);

// Each of the error shapes the host and the transport actually emit is rejected.
const shapes = [
  '[Error] request failed',
  'Embedding provider 请求失败：HTTP 400 model not found',
  'upstream status 503: service unavailable',
  'Too Many Requests',
  '请求失败，请稍后重试',
  'invalid api key',
];
for (const shape of shapes) {
  const ctx = makeCtx(shape);
  globalThis.SillyTavern = { getContext: () => ctx };
  await assert.rejects(() => mod.processSummaryHierarchy(ctx), /返回错误而不是摘要/, `must reject: ${shape}`);
}

// Narrative text that merely mentions a number must survive.
const narrative = makeCtx('塞拉菲娜在码头等了 400 秒，看着锈锚号靠岸。');
globalThis.SillyTavern = { getContext: () => narrative };
assert.equal((await mod.processSummaryHierarchy(narrative)).created, 1, 'plain narrative must not be mistaken for an error');

console.log('PASS v5.5 summary error strings: a failed provider generation is never stored as a summary');
