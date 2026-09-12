import assert from 'node:assert/strict';
import { updateNarrative, buildNarrativeContext, runNarrativeGeneration, generateNarrativeSummary, readNarrativeReport } from './narrative-runtime.js';
import { parseAnchors, mergeKnowledge } from './raw-history.js';
import { requestSummary, summaryResponse } from './summary-transport.js';

const K = 'aetheriaUnifiedMemoryV54';
const body = '队伍在大厅等候。\n【锚点】\n- 所有权 | 钥匙属于甲\n【已解决】\n- 无\n【知情边界】\n- 乙 | 不知道 | 密码';
const pair = n => [{ is_user: true, mes: `第${n}轮进入大厅。` }, { is_user: false, mes: `管家回应第${n}轮，钥匙属于甲。` }];
function host() {
    const ctx = { extensionSettings: { [K]: { enabled: true, narrative_every: 10, narrative_setting_tokens: 0 } },
        chatMetadata: { [K]: {} }, chat: [{ is_user: false, mes: '角色开场白。' }],
        saveMetadataDebounced() {}, setExtensionPrompt() {} };
    const services = { vector: () => ({ supported: false }), isCurrent: () => true, summarize: async () => body };
    return { ctx, services, store: () => ctx.chatMetadata[K] };
}

// Cadence is ten completed user turns = twenty dialogue floors, excluding the greeting.
{
    const h = host(); let calls = 0;
    h.services.summarize = async () => { calls++; return body; };
    for (let n = 1; n <= 20; n++) {
        h.ctx.chat.push(pair(n)[0]); await updateNarrative(h.ctx, h.services);
        assert.equal(calls, Math.floor((n - 1) / 10), 'a pending user message cannot trigger a summary');
        h.ctx.chat.push(pair(n)[1]); await updateNarrative(h.ctx, h.services);
        assert.equal(calls, Math.floor(n / 10), 'one summary at ten turns, then another at twenty');
    }
    assert.equal(readNarrativeReport(h.ctx).completed_floors, 20);
    assert.equal(h.ctx.chat.length, 41);
    assert.equal(h.store().narrative_summary.covered.length, 41);
    assert.equal(h.store().narrative_anchors.source_revision, h.store().narrative_knowledge.source_revision);
}

// Reading while a summary is unresolved uses the old committed state, without waiting or stripping it.
{
    const h = host(); h.ctx.chat.push(...Array.from({ length: 10 }, (_, i) => pair(i)).flat());
    await updateNarrative(h.ctx, h.services);
    h.ctx.chat.push(...Array.from({ length: 10 }, (_, i) => pair(i + 10)).flat());
    let release; h.services.summarize = () => new Promise(resolve => { release = resolve; });
    const job = updateNarrative(h.ctx, h.services);
    const bundle = await buildNarrativeContext(h.ctx, h.services);
    assert.match(bundle.currentStateBlock, /钥匙属于甲/);
    assert.equal(h.store().narrative_summary.covered.length, 21);
    assert.equal(h.ctx.chat.at(-3).is_system, undefined, 'unsummarized tail stays visible');
    assert.equal(h.ctx.extensionSettings[K].__narrative_summary_in_progress, undefined);
    // Appending during the request does not invalidate the unchanged source prefix.
    h.ctx.chat.push(...pair(21)); release(body); await job;
    assert.equal(h.store().narrative_summary.covered.length, 41);
    assert.equal(h.store().raw_history.active.length, 43);
}

// Edits invalidate all projections immediately. A late result cannot bring any one of them back.
{
    const h = host(); h.ctx.chat.push(...Array.from({ length: 10 }, (_, i) => pair(i)).flat());
    await updateNarrative(h.ctx, h.services);
    h.ctx.chat.push(...pair(11));
    let release; h.services.summarize = () => new Promise(r => { release = r; });
    const job = updateNarrative(h.ctx, h.services, { force: true });
    h.ctx.chat[2].mes = '钥匙现在属于乙；乙已知道密码。';
    const bundle = await buildNarrativeContext(h.ctx, h.services);
    assert.equal(bundle.currentStateBlock, '');
    assert.equal(h.store().narrative_anchors, undefined);
    assert.equal(h.store().narrative_knowledge, undefined);
    assert.ok(h.ctx.chat.every(row => !row.is_system));
    release(body); await job;
    assert.equal(h.store().narrative_summary, undefined);
}

// Knowledge capacity and explicit resolution preserve new/current information first.
{
    const prior = { entries: Array.from({ length: 20 }, (_, i) => ({ kind: `角色${i}/不知道`, text: `秘密${i}` })) };
    const next = mergeKnowledge(prior, parseAnchors('局面\n【知情边界】\n- 新角色 | 知道 | 新密码'));
    assert.equal(next.entries[0].text, '新密码'); assert.equal(next.overflow, 1);
    const closed = mergeKnowledge({ entries: [{ kind: '乙/不知道', text: '密码' }] },
        parseAnchors('局面\n【已解决】\n- 乙 | 不知道 | 密码\n【知情边界】\n- 乙 | 知道 | 密码'));
    // Resolution retires the old state; a freshly supplied replacement must survive it.
    assert.equal(closed.entries.length, 1);
    assert.equal(closed.entries[0].kind, '乙/知道');
}

// The current-model transport uses a cloned preset and returns metadata, not only extracted text.
{
    const main = { chat_completion_source: 'deepseek', deepseek_model: 'deepseek-v4-flash', show_thoughts: true, openai_max_tokens: 900 };
    let sent;
    const ctx = { chatCompletionSettings: main, ChatCompletionService: { sendRequest: async payload => {
        sent = payload; return { choices: [{ finish_reason: 'stop', message: { content: body } }],
            usage: { completion_tokens: 200, completion_tokens_details: { reasoning_tokens: 0 } } };
    } } };
    const api = { getChatCompletionModel: s => s.deepseek_model,
        createGenerationParameters: async (s, model, type, messages) => ({ generate_data: { model, messages, show_thoughts: s.show_thoughts } }) };
    const result = await requestSummary(ctx, '总结材料', {}, { loadOpenAI: async () => api });
    assert.equal(result.metrics.requested_max_tokens, 8192);
    assert.equal(result.metrics.finish_reason, 'stop'); assert.equal(result.metrics.reasoning_tokens, 0);
    assert.equal(sent.thinking.type, 'disabled'); assert.equal(sent.show_thoughts, false);
    assert.equal(main.show_thoughts, true); assert.equal(main.openai_max_tokens, 900);
    const limit = summaryResponse({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'hidden' } }],
        usage: { completion_tokens_details: { reasoning_tokens: 8192 } } });
    assert.equal(limit.metrics.reasoning_tokens, 8192); assert.equal(limit.text, '');
    assert.equal(JSON.stringify(limit.metrics).includes('hidden'), false);
}

// Legacy fallback can recurse through a quiet interceptor; normal generations still keep memory.
{
    const h = host(); h.ctx.chat.push(...Array.from({ length: 10 }, (_, i) => pair(i)).flat());
    await updateNarrative(h.ctx, h.services);
    h.ctx.extensionSettings[K].quiet_allow_third_party_injection = true;
    let release; h.ctx.generateRaw = () => new Promise(r => { release = r; });
    const request = generateNarrativeSummary(h.ctx, 'summary', h.ctx.extensionSettings[K]);
    const prompts = []; h.ctx.setExtensionPrompt = (...args) => prompts.push(args);
    await runNarrativeGeneration(h.ctx, h.services, [[], 32768, null, 'normal']);
    assert.match(prompts.at(-1)[1], /钥匙属于甲/);
    await runNarrativeGeneration(h.ctx, h.services, [[], 32768, null, 'quiet']);
    assert.equal(prompts.at(-1)[1], '');
    release(body); await request;
    assert.equal(h.ctx.extensionSettings[K].__narrative_summary_in_progress, undefined);
}
console.log('PASS summary lifecycle: 10 user turns, concurrent reads, joint invalidation, request-local transport and response diagnostics');
