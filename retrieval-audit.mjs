// Read-only replay with identical source prefixes and synthetic ten-turn folding for every strategy.
// Final summaries/knowledge are never fed into earlier turns. These are proxy scores, not answer quality.
import fs from 'node:fs';
import path from 'node:path';
import { captureHistory, chunkHistory, rankRawChunks, packRawEvidence, askedThingRecall, profileRecall } from './raw-history.js';
import { planRetrievalQuery, isContinuation } from './retrieval-query.js';

const args=process.argv.slice(2), arg=k=>args[args.indexOf(k)+1];
if(!args.includes('--chat-dir')||!args.includes('--out'))throw Error('Usage: node retrieval-audit.mjs --chat-dir <directory> --out <json>');
const dir=arg('--chat-dir'), strategies=['legacy','user','focused','adaptive'];
const continuationEvidence = args.includes('--keep-directives');
const files=fs.readdirSync(dir).filter(x=>x.endsWith('.jsonl')).sort();
const results=[];
for(const [fileIndex,file] of files.entries()) {
    const lines=fs.readFileSync(path.join(dir,file),'utf8').split(/\r?\n/).filter(Boolean).map(x=>{try{return JSON.parse(x);}catch{return {};}});
    const rows=lines.filter(x=>typeof x.mes==='string'&&x.mes.trim()).map(row=>({...row,is_system:false}));
    const prefix=[], store={}; let complete=0;
    for(const row of rows) {
        prefix.push(row);
        if(!row.is_user){if(prefix.slice(0,-1).at(-1)?.is_user)complete++;continue;}
        if(complete<10)continue;
        const history=captureHistory(store,prefix).history, chunks=chunkHistory(history);
        const boundary=Math.floor(complete/10)*10;
        let turns=0,cut=-1;
        for(let i=0;i<prefix.length-1;i++)if(!prefix[i].is_user&&prefix[i-1]?.is_user&&++turns===boundary){cut=i;break;}
        // Keep the most recent complete user/assistant pair, just as the runtime does.
        const visible=new Set(history.active.filter(id=>history.records[id].index>Math.min(cut,prefix.length-4)));
        const names=[...new Set(prefix.map(x=>x.name).filter(Boolean))];
        const common=planRetrievalQuery(history,{names});
        for(const strategy of strategies) {
            const plan=planRetrievalQuery(history,{strategy,names});
            const ranked=rankRawChunks(chunks,plan.query,[],{visibleSources:visible,names:common.profileNames,continuationEvidence});
            const packed=packRawEvidence(ranked,history,{maxTokens:1000,visibleSources:visible});
            const asked=plan.metricsApplicable?askedThingRecall(chunks,history,{asked:plan.asked,visibleSources:visible,packed:packed.sources}):[];
            const profiles=profileRecall(chunks,history,{names:common.profileNames,visibleSources:visible,packed:packed.sources});
            results.push({fileIndex,split:fileIndex%3===0?'holdout':'comparison',turn:complete,strategy,mode:plan.mode,
                asked:asked.filter(x=>x.recalled).length,askedTotal:asked.length,
                profiles:profiles.filter(x=>x.detailed).length,profileTotal:profiles.length,
                tokens:packed.tokens,slots:packed.sources.length,
                directiveSlots:packed.sources.filter(x=>history.records[x.source].role==='user'&&isContinuation(history.records[x.source].text)).length});
        }
    }
}
const totals=[];
for(const split of ['comparison','holdout'])for(const mode of ['request','continuation'])for(const strategy of strategies){
    const rows=results.filter(x=>x.split===split&&x.mode===mode&&x.strategy===strategy);
    const sum=k=>rows.reduce((n,x)=>n+x[k],0);
    totals.push({split,mode,strategy,turns:rows.length,asked:sum('asked'),askedTotal:sum('askedTotal'),
        profiles:sum('profiles'),profileTotal:sum('profileTotal'),directiveSlots:sum('directiveSlots'),meanTokens:Math.round(sum('tokens')/(rows.length||1))});
}
const report={method:'synthetic folding at 10 completed turns, lexical replay, fixed query-independent denominators; no final-state leakage',files:files.length,totals,results};
fs.writeFileSync(arg('--out'),JSON.stringify(report,null,2));console.log(JSON.stringify({files:files.length,totals},null,2));
