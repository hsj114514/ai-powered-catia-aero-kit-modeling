// SPDX-License-Identifier: GPL-3.0-only
/** Attributable, validated Beta-Binomial data. This module does not execute CATIA. */
import {readFileSync,writeFileSync,existsSync,renameSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export const PRIOR=Object.freeze({alpha:1,beta:1});
const key=p=>{if(typeof p!=='string'||!p||p.length>65536||['__proto__','prototype','constructor'].includes(p))throw new Error('invalid history pattern');return p;};
const count=n=>Number.isSafeInteger(n)&&n>=0;
export function patternKey(plan){const parts=(plan?.steps??[]).map(s=>s.kind==='gsd_api'?s.kind+':'+s.params?.factory:s.kind==='gsd'?s.kind+':'+s.params?.op:s.kind).filter(Boolean);return key(parts.length?parts.join('>'):'empty');}
export class HistoryStore{
  constructor(file=null){this.file=file;this.data={patterns:Object.create(null)};
    if(file&&existsSync(file)){const stored=JSON.parse(readFileSync(file,'utf8'));if(!stored?.patterns||typeof stored.patterns!=='object'||Array.isArray(stored.patterns))throw new Error('invalid history file');
      for(const [p,v]of Object.entries(stored.patterns)){key(p);if(!count(v.successes)||!count(v.failures)||!Number.isSafeInteger(v.successes+v.failures))throw new Error('invalid history counters');this.data.patterns[p]=structuredClone(v);}}
  }
  record(pattern,outcome,detail=''){key(pattern);if(!['success','failure'].includes(outcome))throw new Error('outcome must be success or failure');
    const p=structuredClone(this.data.patterns[pattern]??{successes:0,failures:0,last:null}),field=outcome==='success'?'successes':'failures';
    if(!Number.isSafeInteger(p[field]+1)||!Number.isSafeInteger(p.successes+p.failures+1))throw new Error('history counter overflow');
    p[field]++;p.last={outcome,detail,at:new Date().toISOString()};
    const next={patterns:{...this.data.patterns,[pattern]:p}};
    if(this.file){const temp=this.file+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,JSON.stringify(next,null,2),{flag:'wx'});renameSync(temp,this.file);}finally{if(existsSync(temp))unlinkSync(temp);}}
    this.data.patterns[pattern]=p;return structuredClone(p);
  }
  posterior(pattern){key(pattern);const p=this.data.patterns[pattern];if(!p)return null;const n=p.successes+p.failures;return {...structuredClone(p),n,posteriorMean:Number(((PRIOR.alpha+p.successes)/(PRIOR.alpha+PRIOR.beta+n)).toFixed(4))};}
  reliabilityFor(plan){return this.posterior(patternKey(plan))?.posteriorMean??null;}
  patterns(){return Object.keys(this.data.patterns);}
}
