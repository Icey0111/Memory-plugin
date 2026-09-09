// Iteration 08: same display name must not silently link two different characters.
import assert from 'node:assert/strict';
import { deriveActorIdentity, stampRuntimeIdentity } from './v55-runtime.js';
import { createEmptyStore } from './memory-core.js';

const store = createEmptyStore();
store.memories = {
  m1: { id: 'm1', kind: 'state', status: 'active', text: '小美在咖啡店工作。', entities: ['小美', 'Bob'], known_by: ['Bob'], entity_scope: 'cafe' },
  m2: { id: 'm2', kind: 'state', status: 'active', text: '小美在学校读书。', entities: ['小美'], known_by: [], entity_scope: 'school' },
  m3: { id: 'm3', kind: 'state', status: 'active', text: '小美是一个常见名字。', entities: ['小美'], known_by: [] },
  m4: { id: 'm4', kind: 'state', status: 'active', text: '咖啡店的小美又出现了。', entities: ['小美'], known_by: [], entity_scope: 'cafe' },
};
const ctx = {
  name1: 'User', name2: 'Bob', characterId: 2,
  chatId: 'chat-entity', chat: [{ is_user: true, mes: '你好' }],
  extensionSettings: { aetheriaUnifiedMemoryV54: { setting_store: { active_world_id: null, worlds: {}, revisions: {}, entries: {} } } },
  chatMetadata: { aetheriaUnifiedMemoryV54: store },
  getCurrentChatId: () => 'chat-entity',
};
const identity = stampRuntimeIdentity(ctx);
assert.equal(identity.chat_id, 'chat-entity');

const registry = store.entity_registry;
const idOf = memory => memory.entity_ids[0];
assert.notEqual(idOf(store.memories.m1), idOf(store.memories.m2), 'same name with different scopes must not share an entity id');
assert.notEqual(idOf(store.memories.m1), idOf(store.memories.m3), 'unscoped name must not link to a scoped entity');
assert.equal(idOf(store.memories.m1), idOf(store.memories.m4), 'same explicit scope must reuse one entity id');

const bobId = store.memories.m1.entity_ids.find(id => id !== idOf(store.memories.m1));
assert.equal(registry[bobId].discriminator, 'st-character:2', 'host character uses the SillyTavern discriminator');
assert.equal(registry[idOf(store.memories.m1)].discriminator, 'story:cafe');
assert.equal(registry[idOf(store.memories.m2)].discriminator, 'story:school');

const bobActor = deriveActorIdentity(ctx, store);
assert.ok(bobActor.ids.includes(bobId), 'actor identity resolves the host character id');
assert.ok(bobActor.aliases.includes('bob'));

console.log('PASS entity identity: host discriminator + explicit story scope keep same-name characters apart');
