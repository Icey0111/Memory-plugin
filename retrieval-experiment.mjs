// Two-phase, labelled retrieval evaluation. All cache keys include exact inputs; no network or credentials here.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { chunkHistory, rankRawChunks, packRawEvidence } from './raw-history.js';
import { planRetrievalQuery } from './retrieval-query.js';
import { rerankShortlist, applyRerankOrder } from './v55-rerank.js';
import { estimateTokens } from './v55-tokenizer.js';
const [phase, input, output, cachePath] = process.argv.slice(2);
const key = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const data=JSON.parse(fs.readFileSync(input,'utf8'));
if(phase==='prepare') {
    const rows=fs.readFileSync(data.chatFile,'utf8').split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
    const store=rows.find(x=>x.chat_metadata).chat_metadata.aetheriaUnifiedMemoryV54;
    const history=store.raw_history;
    const chunks=chunkHistory(history);
    const chatRows=rows.filter(x=>typeof x.mes==='string');
    const visible=[...history.active.filter(id=>!chatRows[history.records[id].index]?.is_system)];
    const names=[...new Set((store.narrative_knowledge?.entries||[]).map(x=>x.kind.split('/')[0]))];
    const samples=[];
    for(const item of data.cases) {
        if(!chunks.some(x=>x.text.includes(item.needle)))throw Error('Missing gold source: '+item.id);
        const queryId='evaluation_user';
        const h={...history,active:[...history.active,queryId],records:{...history.records,
            [queryId]:{id:queryId,index:chatRows.length,role:'user',text:item.question,name:'User'}}};
        for(const strategy of ['legacy','adaptive']) {
            const plan=planRetrievalQuery(h,{strategy,summary:store.narrative_summary?.text||'',names});
            samples.push({...item,strategy,query:plan.query,names:plan.profileNames,vectorKey:key({model:data.embeddingModel,query:plan.query})});
        }
    }
    fs.writeFileSync(output,JSON.stringify({chatId:data.chatId,model:data.model,embeddingModel:data.embeddingModel,history,visible,samples,
        vectorRequests:[...new Map(samples.map(s=>[s.vectorKey,{id:s.vectorKey,query:s.query}])).values()]},null,2));
} else if(phase==='candidates') {
    const rawCache=JSON.parse(fs.readFileSync(cachePath,'utf8')), cache=rawCache.value||rawCache;
    const chunks=chunkHistory(data.history), visible=new Set(data.visible), requests=new Map(), samples=[];
    for(const s of data.samples)for(const dense of [false,true]) {
        const response=cache.responses[s.vectorKey];
        if(dense&&(!response||response.error))throw Error('Missing vector response: '+s.vectorKey);
        const ranked=rankRawChunks(chunks,s.query,dense?response.rows:[],{visibleSources:visible,names:s.names});
        const pick=rerankShortlist(ranked,visible);
        const request={query:s.query,documents:pick.map(x=>x.chunk.retrievalText),model:data.model};
        const id=key(request);
        requests.set(id,{id,...request});
        samples.push({...s,dense,rerankKey:id,ranked,pick});
    }
    fs.writeFileSync(output,JSON.stringify({...data,samples,rerankRequests:[...requests.values()]},null,2));
} else if(phase==='evaluate') {
    const rawCache=JSON.parse(fs.readFileSync(cachePath,'utf8')), cache=rawCache.value||rawCache, visible=new Set(data.visible), results=[];
    for(const s of data.samples)for(const rerank of [false,true]) {
        const response=cache.responses[s.rerankKey];
        // Parsed files duplicate objects: map the shortlist back to the ranked objects by chunk id.
        const pick=s.pick.map(x=>s.ranked.find(r=>r.chunk.id===x.chunk.id));
        const failed=rerank&&(!response||response.error);
        // Unbounded on purpose: this experiment measures the provider's own order against the fusion, which
        // is how the offline tables in dev_docs were measured. The shipped stage bounds how far it may demote.
        const ranked=rerank&&!failed?applyRerankOrder(s.ranked,pick,response.rows,Infinity):s.ranked;
        const packed=packRawEvidence(ranked,data.history,{maxTokens:1000,visibleSources:visible});
        results.push({id:s.id,strategy:s.strategy,dense:s.dense,rerank,failed:Boolean(failed),
            hit:packed.text.includes(s.needle),tokens:packed.tokens,slots:packed.sources.length,
            ms:rerank?response?.ms??null:0,input_tokens_estimated:rerank?estimateTokens([s.query,...pick.map(x=>x.chunk.retrievalText)].join('\n')):0,
            sources:packed.sources.map(x=>({source:x.source,start:x.start,end:x.end})),
            evidence:packed.text,needle:s.needle,question:s.question});
    }
    const totals=[];
    for(const strategy of ['legacy','adaptive'])for(const dense of [false,true])for(const rerank of [false,true]){
        const r=results.filter(x=>x.strategy===strategy&&x.dense===dense&&x.rerank===rerank);
        totals.push({strategy,dense,rerank,questions:r.length,hits:r.filter(x=>x.hit).length,errors:r.filter(x=>x.failed).length,
            tokens:Math.round(r.reduce((n,x)=>n+x.tokens,0)/r.length),meanMs:Math.round(r.reduce((n,x)=>n+(x.ms||0),0)/r.length)});
    }
    fs.writeFileSync(output,JSON.stringify({totals,results},null,2));console.log(JSON.stringify(totals,null,2));
} else throw Error('phase must be prepare, candidates, or evaluate');
