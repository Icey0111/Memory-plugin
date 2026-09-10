// Aetheria Unified Memory v5.5 — TauriTavern plugin-owned vector backend.
import { hasTauriNativeHttpBridge, requestEmbeddingJsonViaTauriNative } from './v55-tauri-native-http-bridge.js';

const STORE_NAMESPACE = 'aetheria-unified-memory-v55';
const STORE_TABLE = 'vectors';
const CREDENTIAL_TABLE = 'credentials';
const CREDENTIAL_KEY = 'embedding_api_key';
const STORE_VERSION = 3;
const sessionSecrets = new Map();
const collectionCache = new Map();
const collectionLocks = new Map();
let lastDebug = null;

const clean = (value, max = 10000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const getHost = () => globalThis.__TAURITAVERN__ || globalThis.window?.__TAURITAVERN__ || null;
export const isNativeTauriTavern = () => Boolean(getHost());

export function setTauriVectorApiKey(value) {
    const key = clean(value, 20000); if (!key) return false;
    sessionSecrets.set('aetheria', key);
    // The key must never reach WebView localStorage, but "memory only" was too strong a promise:
    // an Android WebView is torn down and recreated far more often than a desktop one, so an
    // in-memory-only key made the user retype it on essentially every launch. The host's own
    // extension store is the documented per-extension persistence, lives outside the WebView, and
    // survives reloads; that is where an Aetheria-owned key belongs.
    void persistTauriVectorApiKey(key);
    return true;
}
export function getTauriVectorApiKey() {
    return sessionSecrets.get('aetheria') || '';
}
export function clearTauriVectorApiKey() {
    sessionSecrets.delete('aetheria');
    void removePersistedTauriVectorApiKey();
    return true;
}
export function rememberTauriVectorSessionSecret(_id, value) { return setTauriVectorApiKey(value); }
export function forgetTauriVectorSessionSecret(_id) { clearTauriVectorApiKey(); return true; }
export function hasTauriVectorSessionSecret(_id) { return Boolean(getTauriVectorApiKey()); }

// getTauriVectorApiKey() stays synchronous because the settings panel renders synchronously; the
// durable copy is pulled in once per session by this hydrated-on-demand step. Callers that are
// about to make a request await it so a reloaded WebView does not report "key not configured".
let credentialHydration = null;
export async function ensureTauriVectorApiKeyLoaded() {
    if (sessionSecrets.has('aetheria')) return true;
    if (!getHost()) return false;
    if (!credentialHydration) {
        credentialHydration = (async () => {
            try {
                const store = await extensionStore();
                const probe = await store.tryGetJson({ namespace: STORE_NAMESPACE, table: CREDENTIAL_TABLE, key: CREDENTIAL_KEY });
                const value = clean(probe?.value ?? probe, 20000);
                if (value) sessionSecrets.set('aetheria', value);
                return Boolean(value);
            } catch (error) {
                lastDebug = { ...(lastDebug || {}), credential_load_error: String(error?.message || error).slice(0, 300) };
                return false;
            }
        })().finally(() => { credentialHydration = null; });
    }
    return await credentialHydration;
}
async function persistTauriVectorApiKey(key) {
    try {
        const store = await extensionStore();
        await store.setJson({ namespace: STORE_NAMESPACE, table: CREDENTIAL_TABLE, key: CREDENTIAL_KEY, value: key });
        return true;
    } catch (error) {
        lastDebug = { ...(lastDebug || {}), credential_persist_error: String(error?.message || error).slice(0, 300) };
        return false;
    }
}
async function removePersistedTauriVectorApiKey() {
    try {
        const store = await extensionStore();
        await deleteStoreEntry(store, CREDENTIAL_TABLE, CREDENTIAL_KEY);
        return true;
    } catch (error) {
        lastDebug = { ...(lastDebug || {}), credential_remove_error: String(error?.message || error).slice(0, 300) };
        return false;
    }
}

async function extensionStore() {
    const host = getHost(); if (!host) throw new Error('TauriTavern Host ABI 不可用。');
    try { await (host.ready ?? globalThis.window?.__TAURITAVERN_MAIN_READY__ ?? Promise.resolve()); } catch {}
    const store = host.api?.extension?.store;
    if (!store || typeof store.tryGetJson !== 'function' || typeof store.setJson !== 'function') throw new Error('TauriTavern extension.store API 不可用。');
    return store;
}

function fnv1a32(value, seed = 0x811c9dc5) {
    let hash = seed >>> 0; const text = String(value ?? '');
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash >>> 0;
}
export function safeCollectionStoreKey(collectionId) {
    const id = clean(collectionId, 4000); if (!id) throw new Error('Vector collectionId 为空。');
    return `c_${fnv1a32(id).toString(36)}_${fnv1a32(`${id.length}|${id}`, 0x9e3779b9).toString(36)}`;
}
const blankCollection = id => ({ version: STORE_VERSION, collection_id: clean(id, 4000), dimension: null, items: [], updated_at: Date.now() });
function normalizeCollection(rawInput, id) {
    const raw = rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput) ? rawInput : {};
    return {
        version: STORE_VERSION,
        collection_id: clean(raw.collection_id || id, 4000),
        dimension: Number(raw.dimension) > 0 ? Number(raw.dimension) : null,
        items: (Array.isArray(raw.items) ? raw.items : []).map(row => ({ hash: Number(row?.hash), index: Number(row?.index) || 0, text: clean(row?.text, 200000), vector: clean(row?.vector, 20_000_000), norm: Number(row?.norm) || 0 })).filter(row => Number.isFinite(row.hash) && row.vector),
        updated_at: Number(raw.updated_at) || Date.now(),
    };
}
async function loadCollection(id) {
    const key = safeCollectionStoreKey(id); if (collectionCache.has(key)) return collectionCache.get(key);
    const store = await extensionStore(); let raw = null;
    raw = await store.tryGetJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key });
    const collection = normalizeCollection(raw?.value ?? raw, id); collectionCache.set(key, collection); return collection;
}
async function saveCollection(collection) {
    const key = safeCollectionStoreKey(collection.collection_id); collection.updated_at = Date.now();
    const store = await extensionStore(); await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: collection }); collectionCache.set(key, collection);
}
// TauriTavern answers a delete of a missing key with CommandError::NotFound, and its Rust layer
// (presentation/commands/helpers.rs -> log_user_visible_error) raises a global "后端错误" toast for
// that error class. The toast is emitted natively, so catching the rejection in JS is not enough:
// purging a collection that was never persisted must not reach deleteJson at all. tryGetJson is the
// documented non-throwing probe, so it is used as the existence check.
function isStoreNotFoundError(error) {
    const text = String(error?.message ?? error ?? '').toLowerCase();
    if (text.includes('not found') || text.includes('notfound')) return true;
    const code = error?.details?.code ?? error?.details?.kind ?? error?.code;
    return typeof code === 'string' && code.toLowerCase().includes('notfound');
}
async function storeEntryExists(store, table, key) {
    try { return Boolean((await store.tryGetJson({ namespace: STORE_NAMESPACE, table, key }))?.found); }
    catch { return false; }
}
async function deleteStoreEntry(store, table, key) {
    if (typeof store.deleteJson !== 'function') return false;
    if (!(await storeEntryExists(store, table, key))) return false;
    try { await store.deleteJson({ namespace: STORE_NAMESPACE, table, key }); return true; }
    catch (error) { if (!isStoreNotFoundError(error)) throw error; return false; }
}
async function deleteCollection(id) {
    const key = safeCollectionStoreKey(id); const store = await extensionStore();
    collectionCache.delete(key);
    if (typeof store.deleteJson !== 'function') { await store.setJson({ namespace: STORE_NAMESPACE, table: STORE_TABLE, key, value: blankCollection(id) }); return; }
    await deleteStoreEntry(store, STORE_TABLE, key);
}
function withCollectionLock(id, task) {
    const key = safeCollectionStoreKey(id), previous = collectionLocks.get(key) || Promise.resolve();
    const run = previous.then(task, task), tail = run.catch(() => {}); collectionLocks.set(key, tail);
    return run.finally(() => { if (collectionLocks.get(key) === tail) collectionLocks.delete(key); });
}

function bytesToBase64(bytes) { if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64'); let s=''; for (let i=0;i<bytes.length;i+=0x8000) s+=String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length,i+0x8000))); return btoa(s); }
function base64ToBytes(value) { const t=clean(value,30_000_000); if (typeof Buffer!=='undefined') return new Uint8Array(Buffer.from(t,'base64')); const b=atob(t), out=new Uint8Array(b.length); for(let i=0;i<b.length;i++) out[i]=b.charCodeAt(i); return out; }
export function encodeVector(input) { const v=input instanceof Float32Array?input:Float32Array.from(input||[]); if(!v.length) throw new Error('Embedding 返回空向量。'); return bytesToBase64(new Uint8Array(v.buffer,v.byteOffset,v.byteLength)); }
export function decodeVector(value) { const bytes=base64ToBytes(value); if(bytes.byteLength%4) throw new Error('持久化向量长度无效。'); const copy=new Uint8Array(bytes.byteLength); copy.set(bytes); return new Float32Array(copy.buffer); }
export function vectorNorm(input) { const v=input instanceof Float32Array?input:Float32Array.from(input||[]); let sum=0; for(const x of v) sum+=x*x; return Math.sqrt(sum); }
export function cosineSimilarity(aInput,bInput,naInput=null,nbInput=null) { const a=aInput instanceof Float32Array?aInput:Float32Array.from(aInput||[]), b=bInput instanceof Float32Array?bInput:Float32Array.from(bInput||[]); if(!a.length||a.length!==b.length) return -1; let dot=0; for(let i=0;i<a.length;i++) dot+=a[i]*b[i]; const na=Number(naInput)>0?Number(naInput):vectorNorm(a), nb=Number(nbInput)>0?Number(nbInput):vectorNorm(b); return na&&nb?dot/(na*nb):-1; }

function isJina(apiUrl, model) { try { const h=new URL(apiUrl).hostname.toLowerCase(); if(h==='api.jina.ai'||h.endsWith('.jina.ai')) return true; } catch {} return /^jina-/i.test(String(model||'')); }
export function buildDirectEmbeddingBody({model,texts,apiUrl,role='document'}) { const body={model:clean(model,1000),input:Array.from(texts||[],v=>clean(v,200000))}; if(!body.model||!body.input.length||body.input.some(v=>!v)) throw new Error('Embedding model/input 配置无效。'); if(isJina(apiUrl,model)) body.task=role==='query'?'retrieval.query':'retrieval.passage'; return body; }
export function resolveOpenAiCompatibleBaseUrl(value) { let base=clean(value,4000).replace(/[?#].*$/,'').replace(/\/+$/,''); if(!base) return ''; base=base.replace(/\/(?:embeddings|models)$/i,'').replace(/\/chat\/completions$/i,'').replace(/\/+$/,''); if(!/\/v\d[\w.-]*$/i.test(base)) base=`${base}/v1`; return base; }

function parseEmbeddingPayload(payload, expectedCount) {
    if(!Array.isArray(payload?.data)) throw new Error('Embedding provider 返回格式无效：缺少 data 数组。');
    const vectors=[...payload.data].sort((a,b)=>Number(a?.index??0)-Number(b?.index??0)).map(r=>r?.embedding).filter(Array.isArray).map(r=>Float32Array.from(r.map(Number)));
    if(vectors.length!==expectedCount) throw new Error(`Embedding provider 返回向量数量不匹配：期望 ${expectedCount}，实际 ${vectors.length}。`);
    if(vectors.some(v=>!v.length||Array.from(v).some(x=>!Number.isFinite(x)))) throw new Error('Embedding provider 返回空向量或非数值向量。');
    return vectors;
}

async function requestEmbeddings(config,texts,role,fetchImpl) {
    if (isNativeTauriTavern()) await ensureTauriVectorApiKeyLoaded();
    const apiKey=getTauriVectorApiKey(); if(!apiKey) throw new Error('Aetheria Embedding API Key 未配置。请在插件向量 API 区域重新输入并保存；不会读取或修改酒馆自己的 API Key。');
    const baseUrl=resolveOpenAiCompatibleBaseUrl(config.apiUrl), body=buildDirectEmbeddingBody({model:config.model,texts,apiUrl:baseUrl,role}), endpoint=`${baseUrl}/embeddings`;
    if (isNativeTauriTavern() && hasTauriNativeHttpBridge()) {
        const payload = await requestEmbeddingJsonViaTauriNative({ endpoint, apiKey, body });
        lastDebug={...(lastDebug||{}),transport:'tauri-native-http',provider_endpoint:endpoint};
        return parseEmbeddingPayload(payload,texts.length);
    }
    let response;
    try { response=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body)}); }
    catch(error) { throw new Error(`Embedding 网络请求失败：${String(error?.message||error)}。当前宿主没有可用 Native HTTP bridge；请检查网络/CORS/代理。`); }
    if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`Embedding provider 请求失败：HTTP ${response.status}${detail?` · ${detail.slice(0,500)}`:''}`);}
    return parseEmbeddingPayload(await response.json().catch(()=>null),texts.length);
}

const jsonResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','x-aetheria-vector-backend':'tauritavern-plugin'}});
const noContentResponse=()=>new Response(null,{status:204,headers:{'x-aetheria-vector-backend':'tauritavern-plugin'}});
const topK=value=>Math.max(1,Math.min(500,Math.floor(Number(value)||20)));
const threshold=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(-1,Math.min(1,n)):0;};

async function insertCollection(payload,config,fetchImpl){const items=Array.isArray(payload.items)?payload.items:[];if(!items.length)return jsonResponse({ok:true,inserted:0});const vectors=await requestEmbeddings(config,items.map(i=>i?.text),'document',fetchImpl);return withCollectionLock(payload.collectionId,async()=>{const c=await loadCollection(payload.collectionId),d=vectors[0]?.length||0;if(c.dimension&&c.dimension!==d)throw new Error(`向量维度变化：集合=${c.dimension}，新向量=${d}。请重建派生集合。`);c.dimension=d;const m=new Map(c.items.map(r=>[Number(r.hash),r]));items.forEach((item,i)=>{const v=vectors[i];m.set(Number(item.hash),{hash:Number(item.hash),index:Number.isFinite(Number(item.index))?Number(item.index):i,text:clean(item.text,200000),vector:encodeVector(v),norm:vectorNorm(v)});});c.items=[...m.values()];await saveCollection(c);lastDebug={at:Date.now(),action:'insert',collection_id:payload.collectionId,inserted:items.length,total:c.items.length,dimension:d,transport:isNativeTauriTavern()&&hasTauriNativeHttpBridge()?'tauri-native-http':'web-fetch'};return jsonResponse({ok:true,inserted:items.length});});}
async function queryCollection(payload,config,fetchImpl){const [q]=await requestEmbeddings(config,[payload.searchText],'query',fetchImpl),qn=vectorNorm(q);return withCollectionLock(payload.collectionId,async()=>{const c=await loadCollection(payload.collectionId);if(c.dimension&&c.dimension!==q.length)throw new Error(`查询向量维度与集合不一致：集合=${c.dimension}，查询=${q.length}。`);const ranked=c.items.map(row=>({row,score:cosineSimilarity(q,decodeVector(row.vector),qn,row.norm)})).filter(x=>Number.isFinite(x.score)).sort((a,b)=>b.score-a.score).slice(0,topK(payload.topK)),min=threshold(payload.threshold),metadata=ranked.filter(x=>x.score>=min).map(x=>({hash:x.row.hash,text:x.row.text,index:x.row.index})),hashes=ranked.map(x=>Number(x.row.hash));lastDebug={at:Date.now(),action:'query',collection_id:payload.collectionId,candidates:c.items.length,returned:metadata.length,threshold:min,transport:isNativeTauriTavern()&&hasTauriNativeHttpBridge()?'tauri-native-http':'web-fetch'};return jsonResponse({metadata,hashes});});}
async function listCollection(payload){return withCollectionLock(payload.collectionId,async()=>jsonResponse((await loadCollection(payload.collectionId)).items.map(r=>Number(r.hash))));}
async function deleteItems(payload){const hashes=new Set((Array.isArray(payload.hashes)?payload.hashes:[]).map(Number).filter(Number.isFinite));return withCollectionLock(payload.collectionId,async()=>{const c=await loadCollection(payload.collectionId),before=c.items.length;c.items=c.items.filter(r=>!hashes.has(Number(r.hash)));await saveCollection(c);return jsonResponse({ok:true,deleted:before-c.items.length});});}
async function purgeCollection(payload){return withCollectionLock(payload.collectionId,async()=>{await deleteCollection(payload.collectionId);lastDebug={at:Date.now(),action:'purge',collection_id:payload.collectionId};return noContentResponse();});}

export async function handleTauriVectorRequest(endpoint,payloadInput,configInput,fetchImpl=globalThis.fetch?.bind(globalThis)){if(!isNativeTauriTavern())return null;const payload=payloadInput&&typeof payloadInput==='object'?payloadInput:{},config=configInput&&typeof configInput==='object'?configInput:{};if(!clean(payload.collectionId,4000))throw new Error('Tauri vector request 缺少 collectionId。');if(['insert','query'].includes(endpoint)&&(!clean(config.apiUrl,4000)||!clean(config.model,1000)))throw new Error('Tauri direct Embedding transport 配置不完整。');if(['insert','query'].includes(endpoint)&&!hasTauriNativeHttpBridge()&&typeof fetchImpl!=='function')throw new Error('Embedding transport 不可用。');switch(endpoint){case'insert':return insertCollection(payload,config,fetchImpl);case'query':return queryCollection(payload,config,fetchImpl);case'list':return listCollection(payload);case'delete':return deleteItems(payload);case'purge':return purgeCollection(payload);default:throw new Error(`Tauri plugin vector backend 不支持 endpoint: ${endpoint}`);}}
export function getTauriVectorBackendStatus(){return{active:isNativeTauriTavern(),backend:'tauritavern-plugin-vector-v3',persistence:'window.__TAURITAVERN__.api.extension.store',credential_scope:'tauritavern-extension-store',transport:hasTauriNativeHttpBridge()?'tauri-native-http':'web-fetch-fallback',has_api_key:Boolean(getTauriVectorApiKey()),cached_collection_count:collectionCache.size,last_debug:lastDebug?structuredClone(lastDebug):null};}
export function __testResetTauriVectorBackend(){sessionSecrets.clear();credentialHydration=null;collectionCache.clear();collectionLocks.clear();lastDebug=null;}
