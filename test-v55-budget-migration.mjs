// A measured default correction must reach existing installs, and must not keep overwriting a user's
// later choice. This pins both halves.
import assert from 'node:assert/strict';
import { migrateMemoryBudgets, MEMORY_BUDGET_VERSION } from './index.js';

// An install carrying the old values is corrected exactly once.
const old = { spine_injection_max_chars: 600, spine_injection_max_rows: 8, reference_context_max_chars: 12000, current_state_context_max_chars: 20000, context_reply_reserve_tokens: 777 };
const first = migrateMemoryBudgets(old);
assert.equal(first.migrated, true, 'an install on the old budgets must be migrated');
assert.equal(old.spine_injection_max_chars, 4000);
assert.equal(old.spine_injection_max_rows, 24);
assert.equal(old.reference_context_max_chars, 4000, 'the migration must run every step up to the current version');
// v4 owns this one now: the state is rendered once, so the cap bounds one rendering instead of a share of two.
assert.equal(old.current_state_context_max_chars, 12000, 'the state cap is corrected to the size the single rendering actually needs');
assert.equal(old.context_reply_reserve_tokens, 777, 'a budget the migration does not own must be untouched');
assert.equal(old.memory_budget_version, MEMORY_BUDGET_VERSION);

// Running again changes nothing, so a value the user edits afterwards survives.
old.spine_injection_max_chars = 1234;
const second = migrateMemoryBudgets(old);
assert.equal(second.migrated, false, 'the migration must not run twice');
assert.equal(old.spine_injection_max_chars, 1234, 'a user edit after migration must be kept');

// A fresh install is already at the current version and is left alone.
const fresh = { memory_budget_version: MEMORY_BUDGET_VERSION, spine_injection_max_chars: 4000 };
assert.equal(migrateMemoryBudgets(fresh).migrated, false);

console.log('PASS v5.5 memory budget migration: measured corrections reach existing installs once, and never twice');
