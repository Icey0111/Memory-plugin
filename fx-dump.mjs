import { readFileSync } from 'node:fs';
import { applyMemoryOps, createEmptyStore } from './memory-core.js';
const fx = JSON.parse(readFileSync('./tcausal-cases.json','utf8'));
let store = createEmptyStore();
for (const t of fx.turns) { const r = applyMemoryOps(store, t.ops, { sourceMessageIndex: t.sourceMessageIndex }); if (r.errors.length) console.log('ERR turn', t.sourceMessageIndex, r.errors); store = r.store || store; }
console.log('slots', JSON.stringify(Object.keys(store.slots)));
const by = {};
for (const m of Object.values(store.memories)) by[m.status] = (by[m.status]||0)+1;
console.log('status', JSON.stringify(by), 'total', Object.values(store.memories).length);
console.log(Object.values(store.memories).map(m => m.status + ' | ' + m.kind + ' | ' + (m.slot||'-') + ' | ' + String(m.text).slice(0,34)).join('\n'));
