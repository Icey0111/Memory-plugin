import assert from 'node:assert/strict';
import {
  buildTauriEmbeddingInvoke,
  buildTauriModelDiscoveryInvoke,
  requestEmbeddingJsonViaTauriNative,
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

const discovery = buildTauriModelDiscoveryInvoke({
  baseUrl: 'https://api.jina.ai/v1',
  apiKey: 'jina-test-key',
});
assert.equal(discovery.command, 'get_chat_completions_status');
assert.equal(discovery.args.dto.reverse_proxy, 'https://api.jina.ai/v1');
assert.equal(discovery.args.dto.proxy_password, 'jina-test-key');
assert.equal(discovery.args.dto.custom_url, '');

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
delete globalThis.__TAURITAVERN__;

console.log('PASS v5.5 Tauri native HTTP bridge: native invoke + query-suffix path preservation + request-local credential');
