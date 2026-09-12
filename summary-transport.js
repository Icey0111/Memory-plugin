// Request-local summary generation. Never mutate the host's foreground preset or persist job flags.
export function summaryResponse(result) {
    const choice = result?.choices?.[0];
    const content = choice?.message?.content ?? result?.content ?? result?.text ?? result;
    const text = typeof content === 'string' ? content.trim() : Array.isArray(content)
        ? content.filter(x => x.type === 'text').map(x => x.text).join('\n').trim() : '';
    const reasoning = choice?.message?.reasoning_content ?? result?.reasoning ?? '';
    return { text, metrics: { finish_reason: choice?.finish_reason ?? result?.stop_reason ?? null,
        content_chars: text.length, reasoning_chars: typeof reasoning === 'string' ? reasoning.length : null,
        reasoning_tokens: result?.usage?.completion_tokens_details?.reasoning_tokens ?? null,
        completion_tokens: result?.usage?.completion_tokens ?? null, prompt_tokens: result?.usage?.prompt_tokens ?? null } };
}

export async function requestSummary(ctx, prompt, settings, { loadOpenAI = () => import('/scripts/openai.js'),
    loadShared = () => import('/scripts/extensions/shared.js') } = {}) {
    const max = Math.max(256, Math.min(16384, Number(settings.summary_max_tokens) || 8192));
    const messages = [{ role: 'user', content: prompt }];
    const signal = AbortSignal.timeout(180000);
    let result, model, source, transport;
    const overrides = (model, source) => /deepseek/i.test(model || source || '') && settings.narrative_summary_thinking !== 'inherit'
        ? { show_thoughts: false, thinking: { type: 'disabled' } } : {};
    if (settings.summary_provider_mode === 'connection_profile') {
        const service = (await loadShared()).ConnectionManagerRequestService;
        const id = settings.summary_connection_profile_id;
        if (!id) throw new Error('请选择总结连接。');
        const profile = service.getProfile(id);
        model = profile.model; source = profile.api;
        transport = 'connection_profile';
        result = await service.sendRequest(id, service.constructPrompt(messages, id), max,
            { stream: false, extractData: false, includePreset: false, includeInstruct: false, signal },
            { temperature: 0.2, ...overrides(model, source) });
    } else if (ctx.ChatCompletionService && ctx.chatCompletionSettings?.chat_completion_source) {
        const api = await loadOpenAI();
        const local = structuredClone(ctx.chatCompletionSettings);
        model = api.getChatCompletionModel(local); source = local.chat_completion_source;
        Object.assign(local, overrides(model, source));
        local.openai_max_tokens = max;
        local.stream_openai = false;
        const { generate_data } = await api.createGenerationParameters(local, model, 'quiet', messages);
        const payload = { ...generate_data, messages, stream: false, max_tokens: max, ...overrides(model, source) };
        transport = 'chat_completion';
        result = await ctx.ChatCompletionService.sendRequest(payload, false, signal);
    } else {
        transport = 'legacy_raw';
        if (ctx.generateRaw) result = await ctx.generateRaw({ prompt, systemPrompt: '忠实压缩剧情，仅输出续接摘要。', responseLength: max });
        else if (ctx.generateQuietPrompt) result = await ctx.generateQuietPrompt({ quietPrompt: prompt, responseLength: max });
        else throw new Error('当前宿主没有可用的后台生成接口。');
    }
    const parsed = summaryResponse(result);
    return { ...parsed, metrics: { ...parsed.metrics, requested_max_tokens: max, model: model || null,
        source: source || null, transport, thinking: overrides(model, source).thinking?.type || 'inherit' } };
}
