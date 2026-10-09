// SPDX-License-Identifier: GPL-3.0-only
/** Offline contracts, synthetic bridge only. No native CAD kernel is invoked. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { axisSystemInput } from '../lib/axis-system.js';
import { commandCatalog, commandInput } from '../lib/gsd-commands.js';
import { apiInput, apiElement, apiSources, apiExpected } from '../lib/gsd-api.js';
import { elementFragment, orderedElements } from '../lib/ops.js';
import { buildToolDefinitions } from '../lib/tools.js';
import { closedLoftInput } from '../lib/closed-solid.js';
let checks=0,calls=0;const check=fn=>{fn();checks++;};
const defs=buildToolDefinitions({readLedger:()=>null,run:async()=>{calls++;throw new Error('must stay offline');}},{maxLevel:3});
const plan=defs.find(t=>t.name==='catia_model_plan');
const rows=commandCatalog();
check(()=>assert.equal(rows.length,29));
check(()=>assert.equal(rows.filter(r=>r.status==='IMPLEMENTED_NOT_LIVE_VERIFIED').length,24));
for(const r of rows){
 check(()=>assert.equal(commandCatalog(r.chinese)[0].english,r.english));
 check(()=>assert.equal(commandCatalog(r.english.toLowerCase())[0].chinese,r.chinese));
 if(r.status==='NOT_IMPLEMENTED') {
  check(()=>assert.throws(()=>commandInput({command:r.english,arguments:[]}),/NOT_IMPLEMENTED/));
  const out=await defs.find(t=>t.name==='catia_gsd_command').execute({project:'OFFLINE',id:'Probe',command:r.chinese,arguments:[]});
  check(()=>assert.equal(out.status,'NOT_IMPLEMENTED'));
 }
}
const domain={factory:'AddNewDatums',arguments:[{ref:'MultiDomain'}],domainIndex:1,expectedDomains:2};
check(()=>assert.deepEqual(apiSources(domain),['MultiDomain']));
const ds=apiElement({id:'DomainTwo',params:domain});
for(const needle of ['domains = gHsf.AddNewDatums','Set gHb = gFeats("MultiDomain").Parent','domainCount <> 2','Set feat = domains(LBound(domains) + 1)','AppendHybridShape feat','VerifyFeature "DomainTwo", "auto"']) check(()=>assert.ok(ds.includes(needle),needle));
for(const p of [{...domain,expectedDomains:0},{...domain,domainIndex:2},{...domain,domainIndex:.5},{...domain,arguments:[null]},{factory:'AddNewOffset',arguments:[{ref:'A'},1,false,.001],domainIndex:0}]) check(()=>assert.throws(()=>apiInput(p)));
const add={factory:'AddNewAdd',arguments:[{ref:'OtherSolid'}],bodySource:'BaseSolid'};
const union=apiElement({id:'Union',params:add});
for(const needle of ['.Parent','If targetBody Is arg','gPart.ShapeFactory.AddNewAdd','VerifyFeature "Union", "solid"','cannot Boolean-add a Body to itself']) check(()=>assert.ok(union.includes(needle)));
check(()=>assert.equal(apiExpected(add),'solid'));
check(()=>assert.throws(()=>apiInput({...add,bodySource:undefined}),/bodySource/));
check(()=>assert.throws(()=>apiInput({factory:'AddNewSewSurface',arguments:[{ref:'Surface'},2],bodySource:'Base'}),/enum/));
check(()=>assert.throws(()=>apiInput({factory:'AddNewMidSurface',arguments:[{ref:'Base'},0,0]}),/positive/));
check(()=>assert.ok(apiElement({id:'Mid',params:{factory:'AddNewMidSurface',arguments:[{ref:'Base'},0,5]}}).includes('Mid Surface support Body')));
const files=['r5-right-front-union.plan.json','r5-left-front-union.plan.json','r5-sketch-capped-front.plan.json','r5-axis-to-axis.plan.json'];
for(const file of files){
 const p=JSON.parse(readFileSync(new URL('../examples/'+file,import.meta.url),'utf8'));
 const out=await plan.execute(p);check(()=>assert.equal(out.status,'SUCCESS',JSON.stringify(out)));
 const elements=Object.fromEntries(p.steps.map(e=>[e.id,e])),order=orderedElements(elements);
 for(const e of order) check(()=>assert.ok(elementFragment(e).length>0));
 for(const e of p.steps.filter(e=>e.kind==='closed_loft')) {
  const {sections}=closedLoftInput(e.params),n=sections[0].length,m=sections.length;
  // Combinatorial boundary proof: BOTH caps, ALL n edges (including last-to-first).
  // This certifies only this construction graph, never CATIA geometry or intersections.
  const faces=[Array.from({length:n},(_,i)=>n-1-i),Array.from({length:n},(_,i)=>(m-1)*n+i)];
  for(let j=0;j<m-1;j++)for(let i=0;i<n;i++)faces.push([j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i]);
  const edges=new Map();
  for(const f of faces)for(let i=0;i<f.length;i++){
   const a=f[i],b=f[(i+1)%f.length],key=[a,b].sort((a,b)=>a-b).join(',');
   edges.set(key,[...(edges.get(key)??[]),a<b?1:-1]);
  }
  check(()=>assert.ok([...edges.values()].every(v=>v.length===2&&v[0]+v[1]===0),'every combinatorial edge has two opposite incident faces'));
 }
 if(file.includes('union')) {
  const unions=p.steps.filter(e=>e.params.factory==='AddNewAdd');check(()=>assert.equal(unions.length,4));
  check(()=>assert.equal(unions[0].params.bodySource,p.steps[0].id));
  check(()=>assert.ok(unions.every((e,i)=>i===0||e.params.bodySource===unions[i-1].id)));
  check(()=>assert.ok(p.steps.some(e=>/FOOT_RIB_SOLID/.test(e.id))&&p.steps.some(e=>/TAIL_FLARE_SOLID/.test(e.id))));
 }
}
const sketch={id:'Sketch',kind:'sketch',params:{plane:'YZ',origin:[50,0,0],points:[[0,0],[10,0],[10,10],[0,10]]}};
const bad=await plan.execute({project:'BAD',steps:[sketch,{id:'BadExtrude',kind:'capped_extrude',params:{from:'Sketch',direction:[0,1,0],length:2}}],dryRun:true});
check(()=>assert.equal(bad.status,'BLOCKED'));check(()=>assert.ok(bad.errors.some(e=>/parallel/.test(e))));
const catalog=await defs.find(t=>t.name==='catia_gsd_catalog').execute({command:'分割'});
check(()=>assert.equal(catalog.commands[0].factories[0],'AddNewHybridSplit'));
check(()=>assert.ok(defs.find(t=>t.name==='catia_gsd_catalog').output.render({},catalog)[0].text.includes('Split / 分割')));
check(()=>assert.equal(catalog.operations.length,1));
for(const p of [{xDirection:[0,0,0]},{xDirection:[1,0,0],yDirection:[1,1,0]},{origin:[1,2]},{secret:1}]) check(()=>assert.throws(()=>axisSystemInput(p)));
check(()=>assert.deepEqual(axisSystemInput({}).z,[0,0,1]));
check(()=>assert.equal(calls,0));
console.log('PASS r5-cross-review: '+checks+' offline checks; 29 command names, 24 adapters, 5 honest gaps, front union/closure contracts. Native closure remains unverified.');
