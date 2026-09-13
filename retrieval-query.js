// Keep the user's request separate from scene context. No model call is needed to choose a query.
export const QUERY_CONTEXT_CHARS = 80;
const CONTINUE = /^(?:请|继续|接着|往下|然后|嗯|好|好的|再来|下一段|续写|go on|continue|next|ok|\s|[。.!！,，…])+$/i;
export function isContinuation(text) {
    const body = String(text || '').replace(/\[(?:导演|写作要求|OOC)[\s\S]*?\]/gi, '').trim();
    return !body || CONTINUE.test(body);
}

export function planRetrievalQuery(history, { strategy = 'focused', summary = '', names = [] } = {}) {
    const rows = history.active.map(id => history.records[id]);
    const latestUser = rows.findLast(row => row.role === 'user');
    const asked = latestUser?.text || '';
    const tail = rows.slice(-3);
    const scene = tail.map(row => row.text).join('\n');
    const profileNames = [...new Set(names)].filter(name => name && name !== '其他' && scene.includes(name));
    const mode = rows.at(-1)?.role !== 'user' || isContinuation(asked) ? 'continuation' : 'request';
    const legacy = tail.map((row, i) => i === tail.length - 1 ? row.text : row.text.slice(-QUERY_CONTEXT_CHARS)).join('\n').slice(-5000);
    let query = legacy;
    if (strategy === 'user') query = asked.slice(-5000);
    if (strategy === 'adaptive' || strategy === 'focused') {
        if (mode === 'request') {
            query = asked.slice(-5000);
            // Names resolve pronouns without flooding a short question with the assistant's prose.
            if (/(?:他|她|它|那人|那件|这件|那个|这个|\bhe\b|\bshe\b|\bit\b)/i.test(asked)) {
                query = [query, profileNames.join(' ')].filter(Boolean).join('\n');
            }
        } else if (strategy === 'adaptive') {
            const priorUser = rows.findLast(row => row.role === 'user' && !isContinuation(row.text));
            query = [summary.slice(-400), priorUser?.text.slice(-300), profileNames.join(' ')].filter(Boolean).join('\n');
            // No invented objective when the chat has only greetings/"continue".
            if (!query.trim()) query = legacy;
        }
    }
    return { strategy, mode, asked, query: query.slice(-5000), profileNames,
        metricsApplicable: mode === 'request', context: scene };
}
