// Offline proofs for the window a character-description channel picks.
//
// Measured defect this file pins: a real chat failed a memory check because the reply described a character's
// appearance confidently and wrongly. The story does introduce her - in one paragraph that describes her
// *before* naming her - and that row was never quoted. Two mechanisms were missing, both measured on a
// labelled ten-question set built from that chat (2/10 needles inside a quoted window before, 8/10 after):
//
//   1. A span quoted because a channel picked it keeps the region that channel found. The trimmed window used
//      to follow the question's own words only, and the words of "外貌和性格是什么" do not occur near the
//      description at all, so the window could not land there.
//   2. A character's introduction is a candidate of its own. The score counts descriptor words near a
//      mention of the name, and the describing sentences name nobody; the name is also too common for the
//      rare-term channel, which drops it as prose. Nothing reached the row.
//
// The synthetic story below reproduces the conditions rather than the text: the name recurs (which is why the
// rarity test drops it as a window term), the description comes before the name, and an action beat outscores
// the introduction. It also pins the control: with the character channel off, the same question does not
// reach the description, so the rule is what does it. No chat text is committed.
import assert from 'node:assert/strict';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, profileTargets, profileRecall,
    queryWindowTerms, descriptorCluster } from './raw-history.js';

const FILLER = '雾压在河面上，风从上游过来。'.repeat(24);
const DESCRIPTION = '*她比我矮半个头，脊背绷得像一张拉满的弓。黑发剪得很短，灰绿色的眼睛扫过屋子，最后落在你身上。'
    + '左颧骨上有一道细白的疤痕，说话时那道疤会随着她抿紧的嘴角轻轻抽动。她穿着深绿色的皮甲，外面罩着'
    + '一件用松针和藤条编成的短斗篷，腰间别着一把磨损得厉害的短刃。*';
// Prose with no descriptor word in it, so the row's dense run is the description and not the scene around it.
const NEUTRAL = '外头的雨声慢慢小了下去，屋里的灯又亮了一些。'.repeat(5);
const INTRODUCTION = FILLER + DESCRIPTION + NEUTRAL + '她叫薇斯珀，是这片林子里的巡林人。';
// The action beat: four mentions of the name, body and weapon words packed around each of them. This is the
// row the score picks, and on the real chat it was an action beat like this one that got quoted instead.
const ACTION = FILLER + '薇斯珀把斗篷上的松针抖落。薇斯珀看了我一眼，薇斯珀把刀按在桌上，薇斯珀抬眼。';
const LATER = FILLER + '薇斯珀从门外进来，把斗篷挂在钩上，又出去了。';
const QUESTION = '薇斯珀的外貌和性格是什么？';
const NEEDLE = '左颧骨';
const ROWS = ['我到了这里。', INTRODUCTION, ACTION, LATER, LATER, LATER];

const row = (mes, isUser = false) => ({ name: isUser ? 'User' : 'Seraphina', is_user: isUser, is_system: false, mes });
const build = () => { const store = {}; const { history } = captureHistory(store, ROWS.map((text, i) => row(text, i === 0))); return { history, chunks: chunkHistory(history) }; };
const quotedText = (history, packed) => packed.sources
    .map(entry => history.records[entry.source].text.slice(entry.start, entry.end));

// --- 1. the introduction row is a candidate, and the densest run of it is the description ---------------
{
    const { history, chunks } = build();
    const targets = profileTargets(chunks, ['薇斯珀']);
    assert.equal(targets.length, 2, 'the channel speaks for the introduction row as well as for the scored one');
    assert.equal(targets[0].introduction, false);
    assert.equal(targets[0].chunk.source, 'raw_3', 'the mention-heavy action beat still wins the score');
    const intro = targets.find(target => target.introduction);
    assert.ok(intro, 'and the row the name is first mentioned in is the second candidate');
    assert.equal(intro.chunk.source, 'raw_2');
    const text = history.records.raw_2.text;
    const region = descriptorCluster(text, text.indexOf('薇斯珀'));
    const descriptionAt = text.indexOf('她比我矮半个头');
    assert.ok(region.hits >= 5, 'the run is dense, not a stray word: ' + region.hits);
    assert.ok(region.start >= descriptionAt - 8 && region.start <= descriptionAt + 30,
        'the region is the describing paragraph, not the scene before it: ' + region.start + ' vs ' + descriptionAt);
    // Density is what decides the run: the paragraph beats the scene even though the scene is longer.
    const scene = descriptorCluster(text.slice(0, descriptionAt + 40), null);
    assert.ok(region.hits > scene.hits, 'the description is denser than the scene that precedes it');
}

// --- 2. the quoted window lands on the description, and only because the channel picked the row ---------
{
    const { history, chunks } = build();
    const withNames = packRawEvidence(rankRawChunks(chunks, QUESTION, [], { names: ['薇斯珀'] }), history,
        { maxTokens: 1000, query: QUESTION });
    const introSpan = withNames.sources.find(entry => entry.source === 'raw_2');
    assert.ok(introSpan, 'the describing row is quoted: ' + JSON.stringify(withNames.sources));
    assert.equal(introSpan.anchored, true, 'and the window sits on the region the channel voted for');
    assert.ok(quotedText(history, withNames).some(text => text.includes(NEEDLE)), 'the needle is inside the quoted text');
    assert.ok(introSpan.start >= history.records.raw_2.text.indexOf('她比我矮半个头') - 8,
        'the window starts at the description, not at the head of the message');
    assert.equal(withNames.trace.find(entry => entry.source === 'raw_2').anchored, true,
        'the trace carries the same reading, so a run where the rule misfires can be told from one where it did not');
    // The control: without the character channel the question's own words do not reach the description.
    const withoutNames = packRawEvidence(rankRawChunks(chunks, QUESTION, [], {}), history,
        { maxTokens: 1000, query: QUESTION });
    assert.ok(!quotedText(history, withoutNames).some(text => text.includes(NEEDLE)),
        'without the channel the question does not reach the description: '
        + JSON.stringify(quotedText(history, withoutNames).map(text => text.slice(0, 20))));
}

// --- 3. a word the whole story uses cannot move a window ------------------------------------------------
{
    const { chunks } = build();
    const plain = queryWindowTerms('薇斯珀是谁');
    assert.ok(plain.grams.includes('薇斯'), 'the name is a place to look when nothing is known about the collection');
    const filtered = queryWindowTerms('薇斯珀是谁', { chunks, dfRatio: 0.25 });
    assert.ok(!filtered.grams.includes('薇斯') && !filtered.grams.includes('薇斯珀'),
        'a term every chunk carries is prose, not a place to look');
    assert.ok(!filtered.words.includes('薇斯珀'), 'and the word layer is filtered by the same test');
    assert.equal(queryWindowTerms('', { chunks, dfRatio: 0.25 }).grams.length, 0, 'an empty question has no terms');
}

// --- 4. one reading per character, over every row the channel speaks for --------------------------------
{
    const { history, chunks } = build();
    const rows = profileRecall(chunks, history, { names: ['薇斯珀'], packed: [{ source: 'raw_3' }] });
    assert.equal(rows.length, 1, 'a character is reported once, not once per row');
    assert.equal(rows[0].quoted, true, 'the action beat does mention the name');
    const described = profileRecall(chunks, history, { names: ['薇斯珀'], packed: [{ source: 'raw_2' }] })[0];
    assert.equal(described.quoted, true, 'the introduction row counts as having quoted the character');
    const nothing = profileRecall(chunks, history, { names: ['薇斯珀'], packed: [] })[0];
    assert.equal(nothing.quoted, false);
    assert.equal(nothing.detailed, false, 'quoting nothing about her is not a description');
}
