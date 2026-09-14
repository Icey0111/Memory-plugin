// Offline proofs that a quoted original window sits where the question is.
//
// Measured defect this file pins: in the FactSurvival3 probe the memory block quoted five rows and none
// of them carried the answer. One of the five was the 833-character reply whose own last sentence says
// "'青石渡'这三个字，是他这渡口的名字" — and it was quoted as its first 205 characters, because a
// trimmed span keeps the head of the message whatever the question asked about. The probe then refused
// the fact truthfully, so a detail the summary had parked never came back through the evidence channel.
//
// What is proved here is the window: after the fix the quoted slice contains the question's own words
// whenever the message does. Whether a live model then answers from it is a paid-run question, not an
// offline one, and this file does not claim it.
import assert from 'node:assert/strict';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence } from './raw-history.js';

const FILLER = '雾压在河面上，风从上游过来。'.repeat(55);
const row = (mes, isUser = false) => ({ name: isUser ? 'User' : 'Seraphina', is_user: isUser, is_system: false, mes });
const build = rows => {
    const store = {};
    const { history } = captureHistory(store, rows);
    return { history, chunks: chunkHistory(history) };
};
const quote = (history, source, packed) => {
    const found = packed.sources.find(entry => entry.source === source);
    assert.ok(found, 'expected ' + source + ' to be quoted, got ' + JSON.stringify(packed.sources));
    return { ...found, text: history.records[source].text.slice(found.start, found.end) };
};

// --- 1. an answer at the end of a long message is quoted, not cut -------------------------------------
{
    const { history, chunks } = build([row('我到了渡口。', true), row(FILLER + '船家说，这渡口叫青石渡。')]);
    const query = '这个渡口叫什么名字？';
    const visible = new Set(['raw_1']);
    const ranked = rankRawChunks(chunks, query, [], { visibleSources: visible });
    const packed = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: visible, query });
    const quoted = quote(history, 'raw_2', packed);
    assert.ok(quoted.text.includes('青石渡'), 'the quoted window must carry the answer; got ' + JSON.stringify(quoted.text.slice(-40)));
    assert.ok(quoted.text.includes('渡口'), 'the quoted window must carry the question\'s own word');
    assert.equal(quoted.trimmed, true, 'a quote that had to be shortened says so in the record');
    assert.equal(packed.trace.find(row => row.source === 'raw_2').trimmed, true,
        'and the trace carries the same reading');
    assert.ok(packed.tokens <= 1000, 'the move must not spend more than the budget');
    assert.ok(quoted.start >= 0 && quoted.end <= history.records.raw_2.text.length, 'the window stays inside the message');
}

// --- 2. without a query nothing moves: the shipped head-anchored window is unchanged -------------------
{
    const { history, chunks } = build([row('我到了渡口。', true), row(FILLER + '船家说，这渡口叫青石渡。')]);
    const visible = new Set(['raw_1']);
    const ranked = rankRawChunks(chunks, '这个渡口叫什么名字？', [], { visibleSources: visible });
    const packed = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: visible });
    const quoted = quote(history, 'raw_2', packed);
    assert.equal(quoted.start, 500, 'the anchor still starts the window when no query is passed');
    assert.ok(!quoted.text.includes('青石渡'), 'and that window is the head, as before');
}

// --- 3. equal coverage does not move a window: the head-anchored one is the incumbent ----------------
{
    const { history, chunks } = build([row('我到了渡口。', true), row('船家说这渡口叫青石渡。' + FILLER)]);
    const visible = new Set(['raw_1']);
    const ranked = rankRawChunks(chunks, '这个渡口叫什么名字？', [], { visibleSources: visible });
    const packed = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: visible, query: '这个渡口叫什么名字？' });
    const quoted = quote(history, 'raw_2', packed);
    assert.equal(quoted.start, 0, 'a window that already covers the question keeps its own position');
}

// --- 4. the merged-envelope shape of the live case: both chunks rank, the head is quoted ---------------
{
    const text = FILLER + '船家说，这渡口叫青石渡。';
    const { history, chunks } = build([row('我到了渡口。', true), row(text)]);
    const own = chunks.filter(chunk => chunk.source === 'raw_2');
    const ranked = own.map((chunk, index) => ({ chunk, score: 1 - index * 0.1, lexical: 1 - index * 0.1, channels: ['lexical'] }));
    const before = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: new Set(['raw_1']) });
    const anchored = quote(history, 'raw_2', before);
    assert.equal(anchored.start, 0, 'the merged envelope is anchored at the message head');
    assert.ok(!anchored.text.includes('青石渡'), 'which is where the answer is cut');
    const after = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: new Set(['raw_1']), query: '这个渡口叫什么名字？' });
    assert.ok(quote(history, 'raw_2', after).text.includes('青石渡'), 'and the question moves it onto the answer');
    assert.equal(after.sources.length, before.sources.length, 'the same number of messages is reached');
}
