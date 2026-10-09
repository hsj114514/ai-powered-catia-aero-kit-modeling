// SPDX-License-Identifier: GPL-3.0-only
/** Synthetic offline regressions, never CATIA specimens. */
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiInput,apiCatalog,apiElement} from '../lib/gsd-api.js';
import {buildToolDefinitions} from '../lib/tools.js';
import {buildPersona} from '../lib/prompt.js';
import {multiSectionWing,multiElementWing,wingSection,releaseHeight} from '../lib/aero-features.js';
import {evaluateBuildPlan,loadWeights} from '../lib/evaluator.js';
import {reviewModel} from '../lib/model-review.js';
import {HistoryStore,patternKey} from '../lib/history-store.js';
import {PRELUDE} from '../lib/vbs.js';
import {classifyFailure} from '../lib/failure-taxonomy.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let checks=0;const check=fn=>{fn();checks++;};
const weights=loadWeights(new URL('../scoring/front_wing_weights.json',import.meta.url));
const main=multiSectionWing({name:'FW_MAIN',rootChord:270,span:1160,aoaRoot:-3});
check(()=>assert.equal(main.steps[0].params.invertProfile,true));
check(()=>assert.equal(main.steps.length,1,'no unconsumed scaffold geometry'));
check(()=>assert.equal(main.ids[0],'FW_MAIN__s1'));
const wing=multiElementWing({name:'FW',main,flaps:[{chordRatio:.32,deflectionDeg:-18,gap:8,overlap:4},{chordRatio:.72,deflectionDeg:-12,gap:6,overlap:3}]});
check(()=>assert.equal(wing.elementCount,3));check(()=>assert.equal(wing.steps[2].params.parentId,'FW_Flap1'));
check(()=>assert.ok(wing.steps.every(s=>s.params.invertProfile===true)));
for(const invalid of [{stations:1},{stations:2.5},{xOffset:NaN},{sweepDeg:90},{invert:'true'},{thickness_scale:0},{span:-1}])check(()=>assert.throws(()=>multiSectionWing({name:'Bad',rootChord:270,span:100,aoaRoot:0,...invalid})));
check(()=>assert.throws(()=>wingSection({id:'Bad',chord:100,position:[0,Infinity,0]})));
check(()=>assert.throws(()=>multiElementWing({name:'Bad',main,flaps:[{chordRatio:-1}]})));
check(()=>assert.equal(releaseHeight().ground_clearance_min,null));
check(()=>assert.equal(classifyFailure('GSD_CAPABILITY_MISSING'), 'F10'));
check(()=>assert.equal(classifyFailure('H01 official rule violation'), 'F8'));
const blend={factory:'AddNewBlend',arguments:[],configure:[{method:'SetCurve',arguments:[1,{ref:'A'}]},{method:'SetCurve',arguments:[2,{ref:'B'}]}]};
check(()=>assert.doesNotThrow(()=>apiInput(blend)));
check(()=>assert.throws(()=>apiInput({...blend,configure:[...blend.configure,{method:'SetCurve',arguments:[2,null]}]}),/curve/));
check(()=>assert.doesNotThrow(()=>apiInput({...blend,configure:[...blend.configure,{method:'SetContinuity',arguments:[1,2]},{method:'SetContinuity',arguments:[1,0]}]})));
check(()=>assert.throws(()=>apiInput({...blend,configure:[...blend.configure,{method:'SetContinuity',arguments:[1,2]},{method:'SetSupport',arguments:[1,{ref:'Support'}]},{method:'SetSupport',arguments:[1,null]}]}),/support/));
check(()=>assert.equal(apiCatalog().operations.length,145));
const calls=[];
const defs=buildToolDefinitions({readLedger:()=>undefined,run:async req=>{calls.push(req);throw new Error('offline regression must not call CATIA');}}, {maxLevel:3});
const tool=defs.find(d=>d.name==='catia_evaluate_plan');check(()=>assert.ok(tool));check(()=>assert.equal(tool.parameters.additionalProperties,false));
const result=await tool.execute({steps:wing.steps,component:'front_wing'});check(()=>assert.equal(result.status,'SUCCESS'));check(()=>assert.equal(result.evaluation.facts.liveInputsProvided,false));check(()=>assert.equal(result.evaluation.breakdown.find(x=>x.metric==='rebuildSuccess').value,null));
const blocked=await tool.execute({steps:wing.steps,component:'front_wing',candidate:{overwrite_source:true}});check(()=>assert.equal(blocked.status,'BLOCKED'));check(()=>assert.equal(blocked.evaluation.total,null));
const illegal=await tool.execute({steps:[{...main.steps[0],params:{...main.steps[0].params,chordRoot:-1}}]});check(()=>assert.equal(illegal.status,'BLOCKED'));check(()=>assert.equal(calls.length,0));
const objectReview=reviewModel(Object.fromEntries(wing.steps.map(s=>[s.id,s])));check(()=>assert.equal(objectReview.status,'SUCCESS'));
const sameSolid=reviewModel([{id:'A',kind:'closed_loft',params:{}},{id:'B',kind:'closed_loft',params:{}}]);check(()=>assert.equal(sameSolid.findings.filter(f=>f.code==='matched-caps-volume-required').length,2));check(()=>assert.equal(sameSolid.findings.filter(f=>f.code==='separate-bodies-no-boolean').length,1));
const tempBase=path.resolve(root,'test'),temp=mkdtempSync(path.join(tempBase,'catia-r2-'));
try{
  writeFileSync(path.join(temp,'a.json'),JSON.stringify({extends:'b.json',metrics:{}}));writeFileSync(path.join(temp,'b.json'),JSON.stringify({extends:'a.json',metrics:{}}));
  check(()=>assert.throws(()=>loadWeights(path.join(temp,'a.json')),/cyclic/));
  writeFileSync(path.join(temp,'a.json'),JSON.stringify({extends:'../other.json',metrics:{}}));check(()=>assert.throws(()=>loadWeights(path.join(temp,'a.json')),/sibling/));
  const file=path.join(temp,'history.json'),store=new HistoryStore(file);store.record('test','success');check(()=>assert.equal(new HistoryStore(file).posterior('test').n,1));
  for(const pattern of ['__proto__','constructor','prototype'])check(()=>assert.throws(()=>store.record(pattern,'success')));
  const snapshot=store.posterior('test');snapshot.successes=99;check(()=>assert.equal(store.posterior('test').successes,1));
  writeFileSync(file,'{}');check(()=>assert.throws(()=>new HistoryStore(file),/invalid history/));
}finally{const rel=path.relative(tempBase,path.resolve(temp));if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('unsafe cleanup path');rmSync(temp,{recursive:true,force:true});}
check(()=>assert.notEqual(patternKey({steps:[{kind:'gsd_api',params:{factory:'AddNewFill'}}]}),patternKey({steps:[{kind:'gsd_api',params:{factory:'AddNewLoft'}}]})));
check(()=>assert.ok(buildPersona({maxLevel:2}).includes('Global Aero Design Skill')));
check(()=>assert.ok(buildPersona({maxLevel:2}).includes('Front Wing Component Skill')));
// D3/D4: script/guard diagnostics only, no root-cause or live-success claim.
const distance=PRELUDE.slice(PRELUDE.indexOf('Sub MeasureDistance('),PRELUDE.indexOf('Sub MeasureFeatureLength('));
check(()=>assert.ok(distance.indexOf('GetMinimumDistance(refB)')<distance.indexOf('Emit key, distanceValue')));
check(()=>assert.ok(distance.includes('distance GetMeasurable A')));
check(()=>assert.ok(distance.includes('distanceReferenceTypes')));
check(()=>assert.ok(PRELUDE.includes('splineInput_')));
const update=PRELUDE.slice(PRELUDE.indexOf('Sub UpdateNow('),PRELUDE.indexOf('Sub DropFeature('));check(()=>assert.ok(update.indexOf('gPart.Update')<update.indexOf('Emit "updated"')));
const source=readFileSync(path.join(root,'lib/tools.js'),'utf8');const rebuild=source.slice(source.indexOf('async function rebuildVersion('),source.indexOf('const outcome = await bridge.run',source.indexOf('async function rebuildVersion(')));
check(()=>assert.ok(rebuild.includes("'NewDocument'")));check(()=>assert.ok(!rebuild.includes('openVersion('),'rebuild uses a fresh document, not the first-stage file'));
for(const name of ['r7-closed-endplate.plan.json','r7-closed-left-endplate.plan.json','r7-gsd-split.plan.json','r8-single-foot-rib-solid.plan.json']){
  const p=JSON.parse(readFileSync(path.join(root,'examples',name),'utf8'));
  const response=await defs.find(d=>d.name==='catia_model_plan').execute({project:p.project??'REGRESSION',steps:p.steps,dryRun:true});check(()=>assert.equal(response.status,'SUCCESS',JSON.stringify(response.errors)));
}
console.log('PASS r2-cross-review: '+checks+' offline regression checks. D3/D4 remain unconfirmed on CATIA.');
