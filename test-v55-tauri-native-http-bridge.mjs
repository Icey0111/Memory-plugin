import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as bridge from './v55-tauri-native-http-bridge.js';
import {
  buildTauriEmbeddingInvoke,
  requestEmbeddingJsonViaTauriNative,
  resolveNativeRequestBudgetMs,
} from './v55-tauri-native-http-bridge.js';

const body = {
  model: 'jina-embeddings-v5-text-small',
  task: 'retrieval.query',
  input: ['hello'],
};

const built = buildTauriEmbeddingInvoke({
  endpoint: 'https://api.jina.ai/v1/embeddings',
  apiKey: 'jina-test-key',
  body,
});
assert.equal(built.command, 'generate_chat_completion');
assert.equal(built.effectivePath, '/v1/embeddings');
assert.match(built.effectiveUrl, /^https:\/\/api\.jina\.ai\/v1\/embeddings\?\/chat\/completions$/);
assert.equal(built.args.dto.chat_completion_source, 'custom');
assert.equal(built.args.dto.custom_api_format, 'openai_compat');
assert.equal(built.args.dto.proxy_password, 'jina-test-key');
assert.equal(built.args.dto.reverse_proxy, 'https://api.jina.ai/v1/embeddings?');
assert.deepEqual(built.args.dto.custom_include_body, body);
assert.deepEqual(built.args.dto.custom_exclude_body, ['messages', 'prompt']);
assert.equal(Object.prototype.hasOwnProperty.call(built.args.dto, 'secret_id'), false);

// Model discovery must not reach the host status command: TauriTavern maps every failure of that
// command through log_user_visible_error, which the native backend-error bridge turns into a global
// "后端错误" toast that an extension cannot suppress. Guard the whole ABI, not just the exports.
assert.equal('buildTauriModelDiscoveryInvoke' in bridge, false);
assert.equal('discoverModelsViaTauriNative' in bridge, false);
const bridgeSource = fs.readFileSync(new URL('./v55-tauri-native-http-bridge.js', import.meta.url), 'utf8');
// Strip line comments first: the header explains *why* the command is avoided, so only real code counts.
const bridgeCode = bridgeSource.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
assert.doesNotMatch(bridgeCode, /get_chat_completions_status/);

const calls = [];
globalThis.__TAURITAVERN__ = {
  ready: Promise.resolve(),
  invoke: {
    async safeInvoke(command, args) {
      calls.push({ command, args });
      return { data: [{ index: 0, embedding: [1, 2, 3] }] };
    },
  },
};
const result = await requestEmbeddingJsonViaTauriNative({
  endpoint: 'https://api.jina.ai/v1/embeddings',
  apiKey: 'jina-test-key',
  body,
});
assert.deepEqual(result.data[0].embedding, [1, 2, 3]);
assert.equal(calls.length, 1);
assert.equal(calls[0].command, 'generate_chat_completion');
assert.equal(calls[0].args.dto.reverse_proxy, 'https://api.jina.ai/v1/embeddings?');
assert.equal(calls[0].args.dto.proxy_password, 'jina-test-key');
assert.equal('secret_id' in calls[0].args.dto, false);

// A host-side timeout is a reachability problem, so the surfaced error has to say that instead of
// echoing the raw host text as if the transport were broken.
globalThis.__TAURITAVERN__ = {
  ready: Promise.resolve(),
  invoke: {
    async safeInvoke() {
      throw new Error('The request timed out before the target service responded. (https://api.jina.ai/v1/embeddings)');
    },
  },
};
await assert.rejects(
  () => requestEmbeddingJsonViaTauriNative({ endpoint: 'https://api.jina.ai/v1/embeddings', apiKey: 'jina-test-key', body }),
  error => {
    assert.match(error.message, /请求超时/);
    assert.match(error.message, /代理/);
    return true;
  },
);
// The host budgets 3 min connect / 10 min request per ChatCompletion call, which is sized for a human
// watching a stream, not for background vector work inside a turn. The plugin bounds its own wait and
// scales it with batch size, clamped so a slow-but-healthy provider is not cut off.
assert.equal(resolveNativeRequestBudgetMs({ input: ['a'] }), 60_000);
assert.equal(resolveNativeRequestBudgetMs({ input: new Array(21).fill('x') }), 70_000);
assert.equal(resolveNativeRequestBudgetMs({ input: new Array(5000).fill('x') }), 150_000);
assert.equal(resolveNativeRequestBudgetMs({ input: ['a'] }, 5000), 5000);
assert.equal(resolveNativeRequestBudgetMs({ input: ['a'] }, 1), 250);
assert.equal(resolveNativeRequestBudgetMs({ input: ['a'] }, 10 ** 9), 150_000);

// A native call that never answers must be abandoned inside the budget instead of hanging the turn,
// and it must leave no live timer behind.
globalThis.__TAURITAVERN__ = {
  ready: Promise.resolve(),
  invoke: { safeInvoke: () => new Promise(() => {}) },
};
const startedAt = Date.now();
await assert.rejects(
  () => requestEmbeddingJsonViaTauriNative({ endpoint: 'https://api.jina.ai/v1/embeddings', apiKey: 'jina-test-key', body, timeoutMs: 1000 }),
  error => {
    assert.match(error.message, /等待宿主原生 HTTP 响应超过/);
    assert.match(error.message, /请求代理/);
    return true;
  },
);
assert.ok(Date.now() - startedAt < 10_000, 'the bounded wait must not fall through to the host budget');
delete globalThis.__TAURITAVERN__;

console.log('PASS v5.5 Tauri native HTTP bridge: native invoke + query-suffix path preservation + request-local credential + no host status ABI + bounded wait + timeout guidance');
