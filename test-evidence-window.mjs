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
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, queryWindowTerms } from './raw-history.js';

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

// --- 5. the window is moved by words first, and by n-grams underneath --------------------------------
{
  // The two layers fail differently: a 2-gram matches prose that shares two characters, which is how the
  // head window of the live tea answer scored as well as the window holding the answer while containing no
  // question word at all. Words are the host's own segmentation and are compared first.
  const terms = queryWindowTerms('灶边那只旧铁罐里装的是什么茶？');
  assert.ok(terms.words.length > 0, 'the question has words');
  assert.ok(terms.words.every(word => word.length >= 2), 'single characters are dropped from the word layer');
  assert.ok(terms.grams.includes('边那'),
    'and the n-gram layer still carries a cross-word fragment - the reason words are compared first');
  assert.ok(terms.grams.every(gram => gram.length >= 2));
  // The live shape at the packer: the head matches only a fragment, the answer sits in the tail behind a word.
  const filler = '河边那棵树很老，雾气压着水面。'.repeat(40);
  const body = filler + '灶边那只旧铁罐里是茉莉茶。';
  const { history } = captureHistory({}, [{ name: 'A', is_user: false, mes: body }]);
  const chunks = chunkHistory(history);
  const ranked = rankRawChunks(chunks, '灶边那只旧铁罐里装的是什么茶？', [], { visibleSources: new Set() });
  const packed = packRawEvidence(ranked, history, { maxTokens: 1000, visibleSources: new Set(),
    query: '灶边那只旧铁罐里装的是什么茶？' });
  const quoted = packed.sources.find(source => source.source === 'raw_1');
  const window = history.records.raw_1.text.slice(quoted.start, quoted.end);
  assert.ok(window.includes('茉莉'), 'the window moves onto the answer: ' + JSON.stringify(window.slice(-30)));
  assert.ok(!history.records.raw_1.text.slice(0, quoted.end - quoted.start).includes('茉莉'),
    'which the head-anchored window of the same length does not');
  assert.equal(quoted.trimmed, true, 'and the quote is recorded as shortened');
}

// --- 6. a window opened on the question's word keeps the phrase that modifies it -----------------------
// The answer modifies the word the question shares - "一个穿灰袍、拄藤杖的老头" answers "最显眼的穿着是什么" -
// so a window opened on 老头 starts one character after 灰袍. It reaches back a little, and only when the
// matched word sits at the window's head: the same reach applied to a window whose answer is in its last
// characters destroys that answer, and section 4 is the guard for that direction.
{
    const filler = '雾压在河面上，风从上游过来。'.repeat(60);
    const body = filler + '有没有遇到过谁？一个穿灰袍、拄藤杖的老头，或者一个卖给你东西的人？';
    const { history, chunks } = build([row('我到了这里。'), row(body)]);
    const query = '那个老头最显眼的穿着是什么？';
    const packed = packRawEvidence(rankRawChunks(chunks, query, [], {}), history, { maxTokens: 1000, query });
    const quoted = packed.sources.map(entry => history.records[entry.source].text.slice(entry.start, entry.end)).join('\n');
    assert.ok(quoted.includes('灰袍'), 'the phrase before the matched word is inside the window: ' + JSON.stringify(quoted.slice(-70)));
}

