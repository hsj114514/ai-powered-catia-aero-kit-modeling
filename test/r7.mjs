// SPDX-License-Identifier: GPL-3.0-only
/** Offline contracts and synthetic bridge replies only. Never launches CATIA. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {closedLoftInput,cappedExtrudeInput,planarPolygon} from '../lib/closed-solid.js';
import {elementFragment,elementContext,expectedGeometry,elementGeometry,orderedElements} from '../lib/ops.js';
import {mirrorParams} from '../lib/solid-ops.js';
import {CatiaBridge,normalizeSettings} from '../lib/bridge.js';
import {buildToolDefinitions} from '../lib/tools.js';
import {apiCatalog} from '../lib/gsd-api.js';
let checks=0;const check=fn=>{fn();checks++;};
const square=[[0,0,0],[10,0,0],[10,5,0],[0,5,0]],shift=(s,z)=>s.map(([x,y])=>[x,y,z]);
const loft={id:'LOFT',kind:'closed_loft',params:{sections:[square,shift(square,2)]}};
check(()=>assert.equal(expectedGeometry(loft),'solid'));
check(()=>assert.equal(planarPolygon(square).area,50));
check(()=>assert.equal(closedLoftInput(loft.params).sections.length,2));
check(()=>assert.equal(closedLoftInput({sections:[shift(square,2),square]}).sections.length,2));
check(()=>assert.equal(planarPolygon([...square,square[0]]).points.length,4));
for(const params of [null,{sections:[]},{sections:[square]},{...loft.params,bad:true},{sections:[square,shift(square,2).slice(0,3)]},{sections:[square,square]},{sections:[square,shift(square,2),shift(square,1)]},{sections:[square,shift(square,2).reverse()]}])check(()=>assert.throws(()=>closedLoftInput(params)));
for(const polygon of [square.map((p,i)=>i===2?[10,5,1]:p),[[0,0,0],[1,1,0],[1,0,0],[0,1,0]],[[0,0,0],[1,0,0],[2,0,0]],[[0,0,0],[1,0,0],[1,0,0],[0,1,0]],[[0,0,0],[NaN,0,0],[0,1,0]]])check(()=>assert.throws(()=>planarPolygon(polygon)));
check(()=>assert.equal(planarPolygon([[0,0,0],[3,0,0],[3,3,0],[1,1,0],[0,3,0]]).area,6));
const script=elementFragment(loft);
for(const needle of ['MakePolygon "LOFT__s1"','AddNewFill()','AddNewLoft()','AddNewJoin','AddNewCloseSurface','Set body = gPart.Bodies.Add()','gTrash.Add gTrash.Count, body','gPart.InWorkObject = body','VerifyFeature "LOFT", "solid"'])check(()=>assert.ok(script.includes(needle),needle));
check(()=>assert.equal((script.match(/AddNewFill\(\)/g)||[]).length,2));
check(()=>assert.ok(script.indexOf('AddNewFill()')<script.indexOf('AddNewCloseSurface')));
check(()=>assert.ok(!script.includes('MakeSpline')));
check(()=>assert.deepEqual(elementGeometry(loft).bounds,{min:[0,0,0],max:[10,5,2]}));
check(()=>assert.equal(elementGeometry(loft).boundsCertified,false));
check(()=>assert.deepEqual(mirrorParams('closed_loft',loft.params).sections[1],shift(square,-2)));
const extrude={id:'CAP',kind:'capped_extrude',params:{from:'WIRE',direction:[0,0,2],length:7}};
check(()=>assert.deepEqual(cappedExtrudeInput(extrude.params).direction,[0,0,1]));
for(const p of [{...extrude.params,direction:[0,0,0]},{...extrude.params,length:0},{...extrude.params,length:Infinity},{...extrude.params,from:'../bad'},{...extrude.params,from:'__proto__'},{...extrude.params,bad:true}])check(()=>assert.throws(()=>cappedExtrudeInput(p)));
const capScript=elementFragment(extrude);
for(const needle of ['AddNewTranslate','AddNewExtrude','AddNewFill()','AddNewCloseSurface','VerifyFeature "CAP", "solid"'])check(()=>assert.ok(capScript.includes(needle)));
const wire={id:'WIRE',kind:'guide_curve',params:{points:square,closed:true}};
check(()=>assert.deepEqual(orderedElements({CAP:extrude,WIRE:wire}).map(e=>e.id),['WIRE','CAP']));
check(()=>assert.throws(()=>orderedElements({CAP:extrude}),/missing capped/));
check(()=>assert.throws(()=>orderedElements({CAP:{...extrude,params:{...extrude.params,from:'CAP'}}}),/cyclic/));
check(()=>assert.equal(apiCatalog({factory:'AddNewHybridSplit'}).operations.length,1));
// Independently reconstruct each native circle from its three points for shared endpoint checks.
const sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>a.map(v=>v/Math.hypot(...a));
function curvePoints(edge,byId) {
 if(edge.kind==='line')return {points:[[edge.params.x1,edge.params.y1,edge.params.z1],[edge.params.x2,edge.params.y2,edge.params.z2]]};
 const [a,b,c]=edge.params.arguments.map(r=>{const p=byId[r.ref].params;return [p.x,p.y,p.z];});
 const u=unit(sub(b,a)),normal=unit(cross(sub(b,a),sub(c,a))),v=cross(normal,u),d=Math.hypot(...sub(b,a));
 const cx=dot(sub(c,a),u),cy=dot(sub(c,a),v),C=[d/2,(cx*cx+cy*cy-d*cx)/(2*cy)];
 const center=a.map((q,i)=>q+u[i]*C[0]+v[i]*C[1]),radius=Math.hypot(...sub(a,center));
 const p=unit(sub(a,center)),q=cross(normal,p);
 const angle=point=>{const t=sub(point,center);return (Math.atan2(dot(t,q),dot(t,p))+2*Math.PI)%(2*Math.PI);};
 let end=angle(c);if(angle(b)>end)end-=2*Math.PI;
 const points=Array.from({length:33},(_,i)=>center.map((co,j)=>co+radius*(p[j]*Math.cos(end*i/32)+q[j]*Math.sin(end*i/32))));
 points[0]=a;points[32]=c;return {points,radius};
}
const here=fileURLToPath(new URL('.',import.meta.url));
const temp=fs.mkdtempSync(path.join(here,'catia-r7-offline-'));
try {
 const projectRoot=path.join(temp,'projects'),bridge=new CatiaBridge(normalizeSettings({projectRoot,maxLevel:1},projectRoot));
 let calls=0;
 bridge.run=async()=>{calls++;throw new Error('CATIA execution prohibited in offline checks');};
 const tools=buildToolDefinitions(bridge,bridge.settings),tool=name=>tools.find(t=>t.name===name),plan=tool('catia_model_plan');
 for(const name of ['catia_closed_loft','catia_capped_extrude','catia_gsd_split'])check(()=>assert.ok(tool(name)));
 for(const e of [loft])check(()=>assert.equal(e.kind, 'closed_loft'));
 for(const steps of [[loft],[extrude,wire]]) {const out=await plan.execute({project:'DRY',steps,dryRun:true});check(()=>assert.equal(out.status,'SUCCESS',JSON.stringify(out)));}
 const reject=async(steps,pattern)=>{const out=await plan.execute({project:'BAD',steps,dryRun:true});check(()=>assert.equal(out.status,'BLOCKED'));check(()=>assert.match(out.errors.join(' '),pattern));};
 await reject([loft,{id:'LOFT__shell',kind:'point',params:{x:0,y:0,z:0}}],/collides/);
 await reject([loft,{id:'LOFT__body',kind:'point',params:{x:0,y:0,z:0}}],/collides/);
 await reject([extrude,{...wire,params:{...wire.params,closed:false}}],/must be closed/);
 await reject([{...extrude,params:{...extrude.params,direction:[1,0,0]}},wire],/parallel to the cap/);
 const surf={id:'SURF',kind:'surface',params:{sections:[[[0,0,0],[10,0,0]],[[0,0,10],[10,0,10]]]}};
 const plane={id:'PLANE',kind:'plane',params:{base:'YZ',offset:5}},point={id:'POINT',kind:'point',params:{x:0,y:0,z:0}};
 const split={id:'SPLIT',kind:'gsd_api',params:{factory:'AddNewHybridSplit',arguments:[{ref:'SURF'},{ref:'PLANE'},1]}};
 for(const orientation of [1,-1]){const out=await plan.execute({project:'SPLIT',steps:[{...split,params:{...split.params,arguments:[{ref:'SURF'},{ref:'PLANE'},orientation]}},surf,plane],dryRun:true});check(()=>assert.equal(out.status,'SUCCESS'));}
 await reject([surf,plane,{...split,params:{...split.params,arguments:[{ref:'SURF'},{ref:'PLANE'},0]}}],/must be -1 or 1/);
 await reject([surf,point,{...split,params:{...split.params,arguments:[{ref:'SURF'},{ref:'POINT'},1]}}],/cutter must/);
 await reject([point,plane,{...split,params:{...split.params,arguments:[{ref:'POINT'},{ref:'PLANE'},1]}}],/requires curve or surface/);
 await reject([loft,plane,{...split,params:{...split.params,arguments:[{ref:'LOFT'},{ref:'PLANE'},1]}}],/requires curve or surface/);
 await reject([{...split,params:{...split.params,arguments:[{ref:'MISSING'},{ref:'PLANE'},1]}},plane],/missing GSD API/);
 const exampleReports=[];
 for(const file of fs.readdirSync(new URL('../examples/',import.meta.url)).filter(f=>f.startsWith('r7-')&&f.endsWith('.plan.json'))) {
  const filename=new URL('../examples/'+file,import.meta.url),p=JSON.parse(fs.readFileSync(filename,'utf8'));
  const out=await plan.execute({...p,steps:undefined,planFile:fs.realpathSync(filename),dryRun:true});
  check(()=>assert.equal(out.status,'SUCCESS',file+JSON.stringify(out)));
  check(()=>assert.ok(p.steps.length<=64));
  let chars=0;
  const elements=Object.fromEntries(p.steps.map(s=>[s.id,s]));
  for(const step of p.steps){const f=elementFragment(step,elementContext(step,elements));chars+=f.length;check(()=>assert.ok(f.split('\n').every(line=>line.length<1023)));}
  for(const solid of p.steps.filter(s=>s.kind==='capped_extrude')) {
   const wire=elements[solid.params.from].params;
   const ids=[...wire.arguments.map(r=>r.ref),...wire.configure.filter(c=>c.method==='AddElement').map(c=>c.arguments[0].ref)];
   const curves=ids.map(id=>curvePoints(elements[id],elements));
   for(let i=0;i<curves.length;i++)check(()=>assert.deepEqual(curves[i].points.at(-1),curves[(i+1)%curves.length].points[0],'native profile seam gap'));
   check(()=>assert.ok(planarPolygon(curves.flatMap(c=>c.points.slice(0,-1))).area>0));
   const expected=/FOOT_RIB/.test(solid.id)?[12,9]:[60,57];
   check(()=>assert.ok(curves.filter(c=>c.radius).every((c,i)=>Math.abs(c.radius-expected[i])<1e-7),'wrong native arc radius'));
  }
  exampleReports.push({file,steps:p.steps.length,solidResults:p.steps.filter(s=>expectedGeometry(s)==='solid').length,generatedCharacters:chars,status:'PASS'});
 }
 check(()=>assert.equal(calls,0));check(()=>assert.equal(fs.existsSync(projectRoot),false));
 // Recording bridge tests the result gate, not CATIA: deliberately misleading success markers.
 for(const volume of [undefined,'','0','-1','NaN','Infinity','100']) {
  const fakeRoot=path.join(temp,'reply-'+String(volume)),fake=new CatiaBridge(normalizeSettings({projectRoot:fakeRoot,maxLevel:1},fakeRoot));
  fake.run=async req=>({ok:true,values:{feature_LOFT:'LOFT',verified_LOFT:'true',geometryReady:'true',saved:'synthetic.CATPart',...(volume===undefined?{}:{volumeMm3_LOFT:volume})},errors:[],durationMs:1});
  const result=await buildToolDefinitions(fake,fake.settings).find(t=>t.name==='catia_model_plan').execute({project:'VOLUME_GATE',steps:[loft]});
  check(()=>assert.equal(result.status,volume==='100'?'SUCCESS':'FAILED',JSON.stringify(result)));
  if(volume!=='100')check(()=>assert.equal(fake.readLedger('VOLUME_GATE'),null,'failed first build must restore absent ledger'));
 }
 console.log(JSON.stringify({status:'PASS',checks,examples:exampleReports,CATIA_calls:0,syntheticBridgeOnly:true,nativeGeometryVerified:false},null,2));
}finally{
 if(fs.realpathSync(path.dirname(temp))!==fs.realpathSync(here)||!path.basename(temp).startsWith('catia-r7-offline-'))throw new Error('Unexpected cleanup target');
 fs.rmSync(temp,{recursive:true,force:true});
}
