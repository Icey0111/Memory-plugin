// Aetheria Unified Memory v5.5 — runtime retrieval self-check.
//
// Local retrieval-eval metrics are useless unless something runs them against the real recall
// chain. This module builds a fixed store covering the failure modes that actually matter
// (数字 / 否定 / 条件 / 承诺 / 偏好变化 / 跨轮), pushes it through the production fusion path, and
// reports per-case hits. It runs offline and is wired to a diagnostics button and to tests.

import {
    applyMemoryOps,
    createEmptyStore,
    diversifyCandidates,
    fuseHybridCandidates,
    lexicalSearchMemories,
    selectTemporalCandidates,
} from './memory-core.js';
import { evaluateRankedCases, scoreRankedCase } from './retrieval-eval.js';
import { rerankCandidates } from './v55-rerank.js';

// Bumped when the chain under test changes: the version is what makes an MRR floor meaningful.
export const SELF_CHECK_VERSION = '5.5-sc2-rerank';

const TURNS = [
    { index: 2, ops: [{ op: 'add', kind: 'knowledge', slot: '平成.knowledge.pass', text: '通行证的编号是 A-7391。', entities: ['平成'], indexable: true }] },
    { index: 4, ops: [{ op: 'add', kind: 'state', slot: 'item.key.location', text: '地下室钥匙没有在平成身上，还留在桌上。', entities: ['平成', '地下室钥匙'], indexable: true }] },
    { index: 6, ops: [{ op: 'add', kind: 'knowledge', slot: 'world.gate.rule', text: '只有持星轨维护证的人才能开启蓝色检修门。', entities: ['星轨维护证', '蓝色检修门'], indexable: true }] },
    { index: 8, ops: [{ op: 'add', kind: 'commitment', slot: '平成.commitment.gate', text: '平成答应帮璃月检查蓝色检修门。', entities: ['平成', '璃月'], indexable: true }] },
    { index: 10, ops: [{ op: 'add', kind: 'knowledge', slot: 'user.preference.style', text: '用户以前喜欢简短回答。', entities: ['用户'], indexable: true }] },
    { index: 12, ops: [{ op: 'add', kind: 'knowledge', slot: 'user.preference.style', text: '用户现在喜欢详细推导。', entities: ['用户'], indexable: true }] },
    { index: 14, ops: [{ op: 'add', kind: 'event', text: '地下室钥匙已经交给了苏晚。', entities: ['苏晚', '地下室钥匙'], status: 'closed', indexable: true }] },
    { index: 16, ops: [{ op: 'add', kind: 'state', slot: 'item.key.holder', text: '苏晚保管着地下室钥匙。', entities: ['苏晚', '地下室钥匙'], indexable: true }] },
];

const CASES = [
    { id: 'number', label: '数字', query: '通行证编号是多少', expectIncludes: 'A-7391', asOfIndex: 20 },
    { id: 'negation', label: '否定', query: '平成拿走地下室钥匙了吗', expectIncludes: '没有在平成身上', asOfIndex: 20 },
    { id: 'condition', label: '条件', query: '蓝色检修门需要什么才能开启', expectIncludes: '星轨维护证', asOfIndex: 20 },
    { id: 'commitment', label: '承诺', query: '平成答应过璃月什么', expectIncludes: '答应帮璃月', asOfIndex: 20 },
    { id: 'preference_change', label: '偏好变化', query: '用户喜欢什么样的回答风格', expectIncludes: '详细推导', asOfIndex: 20 },
    { id: 'cross_turn', label: '跨轮', query: '地下室钥匙现在在谁那里', expectIncludes: '苏晚保管着', asOfIndex: 20 },
];

export function buildSelfCheckStore() {
    let store = createEmptyStore();
    for (const turn of TURNS) {
        const applied = applyMemoryOps(store, turn.ops, {
            sourceMessageIndex: turn.index,
            sourceHash: 1000 + turn.index,
            sourceMessageText: turn.ops.map(op => op.text).join(' '),
        });
        store = applied.store;
    }
    return store;
}

export function memoryIdByText(store, needle) {
    const row = Object.values(store?.memories || {}).find(memory => String(memory?.text || '').includes(needle));
    return row?.id || null;
}

export function runSelfCheckCase(store, testCase, { finalCount = 6 } = {}) {
    const expectedId = memoryIdByText(store, testCase.expectIncludes);
    const lexical = lexicalSearchMemories(store, testCase.query, { limit: 20 });
    const structured = selectTemporalCandidates(store, { asOfIndex: testCase.asOfIndex, limit: 8 });
    const fused = fuseHybridCandidates(store, [], lexical, {
        rrfK: 60,
        lexicalWeight: 0.9,
        denseGate: false,
        structuredLists: [structured],
        currentMessage: testCase.asOfIndex,
        cooldownTurns: 0,
    });
    // The runtime runs the fusion path and then the local reranker; the self-check has to measure the
    // same chain or its MRR floor stops describing production.
    const reranked = rerankCandidates(fused, testCase.query, {
        weight: 0.55,
        currentMessage: testCase.asOfIndex,
        halfLifeTurns: 120,
        maxPool: Math.max(30, finalCount * 5),
    }).rows;
    const selected = diversifyCandidates(reranked, { finalCount, lambda: 0.78 });
    const ranked = selected.map(row => row.memory.id);
    const score = scoreRankedCase({ expected: expectedId ? [expectedId] : [], ranked, k: finalCount });
    return {
        id: testCase.id,
        label: testCase.label,
        query: testCase.query,
        expected_id: expectedId,
        ranked,
        passed: Boolean(expectedId && score.hit),
        reciprocal_rank: score.reciprocal_rank,
    };
}

export function runRetrievalSelfCheck({ finalCount = 6 } = {}) {
    const store = buildSelfCheckStore();
    const cases = CASES.map(testCase => runSelfCheckCase(store, testCase, { finalCount }));
    const metrics = evaluateRankedCases(cases.map(row => ({ expected: row.expected_id ? [row.expected_id] : [], ranked: row.ranked })), { k: finalCount });
    const passed = cases.filter(row => row.passed).length;
    return {
        version: SELF_CHECK_VERSION,
        total: cases.length,
        passed,
        ok: passed === cases.length,
        cases,
        metrics,
    };
}

export function formatSelfCheck(report) {
    if (!report) return '未运行。';
    const lines = ['检索自检 ' + report.passed + '/' + report.total + '（MRR ' + (Number(report.metrics?.mrr) || 0).toFixed(3) + '）'];
    for (const row of report.cases) lines.push('  ' + (row.passed ? 'PASS' : 'FAIL') + ' [' + row.label + '] ' + row.query);
    return lines.join('\n');
}