import assert from 'node:assert/strict';
import { stabilizeProvenanceStore } from './v55-provenance.js';

const store = {
  runtime_identity: { branch_id: 'branch-a' },
  memories: {
    m1: { id: 'm1', branch_id: 'branch-a', world_id: 'w1', chat_id: 'c1' },
  },
  extractions: {
    x1: { transaction_id: 'tx1', branch_id: 'branch-a', world_id: 'w1', chat_id: 'c1' },
  },
};
stabilizeProvenanceStore(store, 'branch-a');
assert.equal(store.provenance_registry.memories.m1.origin_branch_id, 'branch-a');
assert.equal(store.provenance_registry.transactions.tx1.origin_branch_id, 'branch-a');

// Compatibility runtime later recomputes and overwrites the current branch id.
store.memories.m1.branch_id = 'branch-b';
store.extractions.x1.branch_id = 'branch-b';
store.runtime_identity.branch_id = 'branch-b';
stabilizeProvenanceStore(store, 'branch-b');
assert.equal(store.memories.m1.branch_id, 'branch-a', 'memory origin branch must remain stable');
assert.equal(store.extractions.x1.branch_id, 'branch-a', 'transaction origin branch must remain stable');
assert.deepEqual(store.memories.m1.seen_on_branches.sort(), ['branch-a', 'branch-b']);
assert.deepEqual(store.extractions.x1.seen_on_branches.sort(), ['branch-a', 'branch-b']);

// A transaction first appearing on branch B belongs to B.
store.extractions.x2 = { transaction_id: 'tx2', branch_id: 'branch-b', world_id: 'w1', chat_id: 'c1' };
stabilizeProvenanceStore(store, 'branch-b');
assert.equal(store.provenance_registry.transactions.tx2.origin_branch_id, 'branch-b');
assert.equal(store.extractions.x2.branch_id, 'branch-b');

console.log('test-v55-provenance: ok');
