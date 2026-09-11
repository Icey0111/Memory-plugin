import assert from 'node:assert/strict';
import { runWithV55Consistency } from './v55-consistency.js';

const META = 'aetheriaUnifiedMemoryV54';
const SETTINGS = 'aetheriaUnifiedMemoryV54';
const prompts = [];
const ctx = {
  name2: 'Bob',
  characterId: 2,
  chatId: 'chat-1',
  chat: [{ is_user: true, mes: 'Where is the archive?' }],
  extensionSettings: {
    [SETTINGS]: {
      context_reply_reserve_tokens: 1000,
      reference_context_max_chars: 10000,
      current_state_context_max_chars: 4000,
      setting_store: { active_world_id: null, worlds: {}, revisions: {}, entries: {} },
    },
  },
  chatMetadata: { [META]: { memories: {}, extractions: {} } },
  setExtensionPrompt(key, value, ...rest) { prompts.push({ key, value, rest }); },
  saveMetadataDebounced() {},
  getCurrentChatId() { return this.chatId; },
};

const inner = async () => {
  // Simulate the compatibility runtime replacing chat metadata during replay.
  ctx.chatMetadata[META] = {
    memories: {
      secret: { id: 'secret', kind: 'knowledge', status: 'active', text: 'Archive password is RED', known_by: ['Alice'], known_by_ids: ['ent_alice'] },
    },
    extractions: {
      x1: {
        transaction_id: 'tx1',
        source_hash: 1,
        branch_id: 'branch-current',
        chat_id: 'chat-1',
        assistant_index_at_creation: 2,
        event_summary: 'Bob entered the archive hall.',
        operations: [{ op: 'add', kind: 'state', slot: 'scene.location', text: 'Archive Hall', entities: ['Bob'] }],
      },
    },
    entity_registry: {
      ent_bob: { entity_id: 'ent_bob', discriminator: 'st-character:2', aliases: ['Bob'] },
      ent_alice: { entity_id: 'ent_alice', discriminator: 'st-character:1', aliases: ['Alice'] },
    },
    runtime_identity: { branch_id: 'branch-current' },
  };
  ctx.setExtensionPrompt('aetheria_unified_memory_v5_4_reference', '<memory id="secret"><summary>Archive password is RED</summary></memory>', 1, 4, false, 0);
  ctx.setExtensionPrompt('aetheria_unified_memory_v5_4_current_state', '- [knowledge:secret] Archive password is RED\n- [state] Archive Hall', 1, 1, false, 0);
};

await runWithV55Consistency(ctx, inner, [ctx.chat, 4000, null, 'normal']);
const reference = prompts.find(row => row.key === 'aetheria_unified_memory_v5_4_reference');
const current = prompts.find(row => row.key === 'aetheria_unified_memory_v5_4_current_state');
assert.ok(reference && current);
assert.doesNotMatch(reference.value, /password is RED/);
assert.doesNotMatch(current.value, /password is RED/);
// The scene-locator block is not injected: 66% of its characters were measured to be verbatim substrings
// of the layered summary, and it was spending the reference budget the summary needs. The scenes are
// still built and still feed the evidence channel.
assert.doesNotMatch(reference.value, /SCENE SUMMARY LOCATORS/);
assert.match(reference.value, /SCENE EVIDENCE/);
assert.match(reference.value, /archive hall/i);
assert.match(current.value, /Archive Hall/);
assert.ok(ctx.chatMetadata[META].scene_summaries.length === 1);
assert.ok(ctx.chatMetadata[META].v55_consistency.combined_used_chars <= 6000);
assert.equal(ctx.chatMetadata[META].provenance_registry.transactions.tx1.origin_branch_id, 'branch-current');

console.log('test-v55-consistency: ok');
