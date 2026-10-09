// SPDX-License-Identifier: GPL-3.0-only
/** Offline contracts only. Synthetic references below are not CAD specimens. */
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, existsSync, mkdtempSync, rmSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apiInput, apiElement, apiCatalog, apiSources, apiExpected} from '../lib/gsd-api.js';
import {solveG2, evaluateBezier, endpointJet} from '../lib/g2.js';
import {reviewModel} from '../lib/model-review.js';
import {orderedElements, elementBounds, elementFragment, elementContext} from '../lib/ops.js';
import {PRELUDE, assembleScript} from '../lib/vbs.js';
import {CatiaBridge, normalizeSettings} from '../lib/bridge.js';
import {buildToolDefinitions} from '../lib/tools.js';
import {resolveProfile} from '../lib/airfoil.js';
import {expandRequest} from '../lib/ops.js';
const catalog=JSON.parse(readFileSync(new URL('../lib/gsd-catalog.json',import.meta.url),'utf8'));
const operations=apiCatalog().operations;
let checks=0;
const check=fn=>{fn();checks++;};
const sample=s=>s.type==='boolean'?false:s.type==='CATBSTR'?'law':s.type==='CATSafeArrayVariant'?[{ref:'base'}]:s.type==='HybridShapeDirection'?{direction:[1,0,0]}:['Length','Angle','RealParam'].includes(s.type)?{ref:'base',parameter:'Radius'}:s.type==='Reference'||s.type==='Body'||s.type==='HybridShapeIntegratedLaw'?{ref:'base'}:/Continuity/.test(s.name)?0:s.type.startsWith('Cat')?0:1;
function contract(f) {
 const p={factory:f.method,arguments:f.slots.map(sample),configure:[],...(f.owner==='ShapeFactory'?{bodySource:'base'}:{})};
 const call=(name,values)=>({method:name,arguments:values??f.configure.calls.find(c=>c.name===name).slots.map(sample)});
 if(f.method==='AddNewFill')p.configure=[call('AddBound')];
 if(f.method==='AddNewLoft')p.configure=[call('AddSectionToLoft'),call('AddSectionToLoft')];
 if(f.method==='AddNewSpline')p.configure=[call('AddPoint'),call('AddPoint')];
 if(f.method==='AddNewPolyline')p.configure=[call('InsertElement'),call('InsertElement')];
 if(f.method==='AddNewBlend')p.configure=[call('SetCurve',[1,{ref:'base'}]),call('SetCurve',[2,{ref:'base'}])];
 if(!f.slots.length&&!p.configure.length||/^AddNewSweep(?:Circle|Line|Conic)$/.test(f.method)) {
  if(f.configure.properties.length) {let m=f.configure.properties[0];p.configure.push({property:m.name,value:sample(m)});}
  else if(f.configure.calls.length)p.configure.push(call(f.configure.calls[0].name));
  else if(f.configure.valueParameters.length) {let m=f.configure.valueParameters[0];p.configure.push({parameter:m.name,value:sample(m)});}
 }
 if(f.method==='AddNewDatums') Object.assign(p,{domainIndex:0,expectedDomains:2});
 return p;
}
for(const f of operations) {
 const p=contract(f), normalized=apiInput(p), script=apiElement({id:'contract',params:p});
 check(()=>assert.equal(normalized.factory,f.method));
 check(()=>assert.ok(script.includes('.'+f.method+'(')));
 check(()=>assert.ok(script.indexOf('.'+f.method+'(')<script.indexOf('gPart.UpdateObject feat')));
 check(()=>assert.ok(script.indexOf('gPart.UpdateObject feat')<script.indexOf('VerifyFeature')));
 check(()=>assert.equal(script.includes('gHb.AppendHybridShape feat'),f.owner!=='ShapeFactory'));
 check(()=>assert.throws(()=>apiInput({...p,arguments:[...p.arguments,0]}),/exactly/));
 check(()=>assert.throws(()=>apiInput({...p,configure:[...p.configure,{method:'ExecuteCode',arguments:[]}]}),/not documented|no configurable/));
 for(const m of f.configure.calls) {
  check(()=>assert.doesNotThrow(()=>apiInput({...p,configure:[...p.configure,{method:m.name,arguments:m.slots.map(sample)}]})));
  check(()=>assert.throws(()=>apiInput({...p,configure:[...p.configure,{method:m.name,arguments:[...m.slots.map(sample),0]}]}),/exactly/));
 }
 for(const [group,key] of [['properties','property'],['valueParameters','parameter']])for(const m of f.configure[group]) {
  check(()=>assert.doesNotThrow(()=>apiInput({...p,configure:[...p.configure,{[key]:m.name,value:sample(m)}]})));
 }
}
check(()=>assert.equal(operations.length,145));
check(()=>assert.equal(apiCatalog({category:'fillet'}).operations.length,16));
check(()=>assert.equal(apiExpected({factory:'AddNewCircle3Points',arguments:[{ref:'a'},{ref:'b'},{ref:'c'}]}),'curve'));
check(()=>assert.throws(()=>apiInput({factory:'AddNewAutoFillet',arguments:[5,5]}),/bodySource/));
check(()=>assert.deepEqual(apiSources({factory:'AddNewAutoFillet',arguments:[5,5],bodySource:'solid'}),['solid']));
check(()=>assert.throws(()=>apiInput({factory:'Eval',arguments:[]}),/whitelist/));
const point={factory:'AddNewPointCoord',arguments:[1,2,3]};
for(const bad of [NaN,Infinity,'3',null])check(()=>assert.throws(()=>apiInput({...point,arguments:[bad,2,3]})));
check(()=>assert.throws(()=>apiInput({...point,evil:true}),/unknown/));
check(()=>assert.throws(()=>apiInput({factory:'AddNewLoft',arguments:[]}),/explicit|sections/));
const connect={factory:'AddNewConnect',arguments:[{ref:'a'},{ref:'p'},1,2,1,{ref:'b'},{ref:'q'},-1,2,1,false]};
check(()=>assert.doesNotThrow(()=>apiInput(connect)));
check(()=>assert.ok(reviewModel([{id:'c',kind:'gsd_api',params:connect}]).findings.some(f=>f.code==='g2-request-only')));
check(()=>assert.equal(reviewModel([{id:'b',kind:'gsd_api',params:{configure:[{method:'SetContinuity',arguments:[2,0]}]}}]).findings.length,0));
check(()=>assert.throws(()=>apiInput({...connect,arguments:connect.arguments.map((v,i)=>i===3?3:v)}),/G0/));
check(()=>assert.throws(()=>apiInput({...connect,arguments:connect.arguments.map((v,i)=>i===10?'false':v)}),/boolean/));
check(()=>assert.throws(()=>apiInput({...point,configure:[{property:'PtRef',value:{ref:'bad\ncode'}}]}),/invalid source/));
const quoted=apiElement({id:'safe',params:{factory:'AddNewLinePtPt',arguments:[{ref:'a',brep:'Edge:("quoted")'},{ref:'b'}]}});
check(()=>assert.ok(quoted.includes('"Edge:(""quoted"")"')));
const longBrep=apiElement({id:'long',params:{factory:'AddNewLinePtPt',arguments:[{ref:'a',brep:'"'.repeat(8192)},{ref:'b'}]}});
check(()=>assert.ok(longBrep.split('\n').every(line=>line.length<1023)));
const arrayScript=apiElement({id:'array',params:{factory:'AddNewPlaneMean',arguments:[Array.from({length:256},()=>({ref:'base'})),256]}});
check(()=>assert.ok(arrayScript.split('\n').every(line=>line.length<1023)));
check(()=>assert.throws(()=>apiInput({factory:'AddNewLinePtPt',arguments:[{ref:'a',brep:'x\nExecute'},{ref:'b'}]}),/bounded/));
const extrude={factory:'AddNewExtrude',arguments:[{ref:'arc'},10,0,{direction:[0,0,4]}]};
check(()=>assert.deepEqual(apiInput(extrude).arguments[3].direction,[0,0,1]));
check(()=>assert.throws(()=>apiInput({...extrude,arguments:[{ref:'arc'},10,0,{direction:[0,0,0]}]}),/zero/));
const base={id:'base',kind:'point',params:{x:0,y:0,z:0}}, dep={id:'dep',kind:'gsd_api',params:{factory:'AddNewPointCoordWithReference',arguments:[1,2,3,{ref:'base'}]}};
check(()=>assert.deepEqual(orderedElements({dep,base}).map(e=>e.id),['base','dep']));
check(()=>assert.throws(()=>orderedElements({dep}),/missing/));
check(()=>assert.throws(()=>orderedElements({dep,base:{...dep,id:'base',params:{...dep.params,arguments:[1,2,3,{ref:'dep'}]}}}),/cyclic/));
const fillet={id:'fillet',kind:'gsd_api',params:{factory:'AddNewAutoFillet',arguments:[5,5],bodySource:'base'}};
check(()=>assert.deepEqual(orderedElements({fillet,base}).map(e=>e.id),['base','fillet']));
const g2={start:[0,0,0],end:[100,20,10],tangentStart:[1,0,0],tangentEnd:[1,0,0],curvatureStart:[0,.002,0],curvatureEnd:[0,0,.002]};
const solution=solveG2(g2);
check(()=>assert.ok(solution.endpointResidual<1e-10));
check(()=>assert.deepEqual(solution.endpointJets[0].point,g2.start));
check(()=>assert.deepEqual(solution.endpointJets[1].point,g2.end));
check(()=>assert.equal(solution.nativeGeometryVerified,false));
check(()=>assert.equal(solution.controlPoints.length,6));
check(()=>assert.ok(endpointJet(solution.controlPoints,0).curvature.every((n,i)=>Math.abs(n-g2.curvatureStart[i])<1e-10)));
for(let i=1;i<=20;i++)check(()=>assert.ok(solveG2({...g2,speedStart:90+i,speedEnd:100+i}).endpointResidual<1e-9));
for(const invalid of [{end:g2.start},{tangentStart:[0,0,0]},{curvatureStart:[1,0,0]},{speedStart:0},{count:257}])check(()=>assert.throws(()=>solveG2({...g2,...invalid})));
check(()=>assert.throws(()=>evaluateBezier([],0),/control/));
const wing={id:'main',kind:'wing',params:{naca:'2412',span:100,chordRoot:280,chordTip:280,stations:2,aoaRoot:0}};
const flap={id:'flap',kind:'flap',params:{parentId:'main',naca:'2412',chordRatio:.3,deflectionDeg:-20,gap:8,overlap:3}};
const b0=elementBounds(flap,{main:wing}),b1=elementBounds({...flap,params:{...flap.params,gapSide:'positive'}},{main:wing});
check(()=>assert.ok(Math.abs(b1.min[1]-b0.min[1]-16)<1e-8));
const regular=resolveProfile({naca:'2412'}).loop,inverted=resolveProfile({naca:'2412',invertProfile:true}).loop;
check(()=>assert.deepEqual(inverted,regular.map(([x,y])=>[x,-y])));
check(()=>assert.throws(()=>resolveProfile({naca:'2412',invertProfile:'true'}),/boolean/));
const chain=expandRequest('multi_element_wing','w',{naca:'2412',invertProfile:true,flaps:[{chordRatio:.3,gapSide:'positive'},{chordRatio:.5,invertProfile:false}]});
check(()=>assert.equal(chain[1].params.invertProfile,true));
check(()=>assert.equal(chain[2].params.invertProfile,false));
check(()=>assert.equal(chain[1].params.gapSide,'positive'));
check(()=>assert.throws(()=>elementFragment({...flap,params:{...flap.params,gapSide:'sideways'}},elementContext(flap,{main:wing})),/gapSide/));
check(()=>assert.ok(PRELUDE.includes('Sub BindInGeoset')));
check(()=>assert.ok(PRELUDE.includes('For Each s In b.Shapes')));
const sub=name=>PRELUDE.match(new RegExp('Sub '+name+'\\([^]*?End Sub'))?.[0]??'';
check(()=>assert.ok(sub('NewDocument').includes('gOwnedDocument = True')));
check(()=>assert.ok(sub('UseDocument').includes('gOwnedDocument = False')));
check(()=>assert.ok(sub('CleanupFailedBuild').includes('gDoc.Close')&&!sub('CleanupFailedBuild').includes('Documents.Item')));
check(()=>assert.ok(assembleScript({prelude:PRELUDE,body:'',reportPath:'report.txt',op:'offline'}).includes('CleanupFailedBuild')));
check(()=>assert.ok(reviewModel([{id:'s',kind:'gsd',params:{op:'solid_close',from:['base']}}],['UpdateObject failed']).findings.some(f=>f.code==='geometry-update-failure')));
const here=fileURLToPath(new URL('.',import.meta.url)), temp=mkdtempSync(path.join(here,'r3-'));
try {
 const root=path.join(temp,'projects'),bridge=new CatiaBridge(normalizeSettings({projectRoot:root,maxLevel:2},root));
 let calls=0;bridge.run=async()=>{calls++;throw new Error('Offline suite must not call CATIA');};
 const tools=buildToolDefinitions(bridge,bridge.settings),plan=tools.find(t=>t.name==='catia_model_plan');
 const out=await plan.execute({project:'offline',steps:[dep,base],dryRun:true});
 check(()=>assert.equal(out.status,'SUCCESS',JSON.stringify(out)));
 check(()=>assert.equal(calls,0));check(()=>assert.equal(existsSync(root),false));
 const badFillet=await plan.execute({project:'offline',steps:[base,fillet],dryRun:true});
 check(()=>assert.equal(badFillet.status,'BLOCKED'));check(()=>assert.equal(calls,0));
 for(const file of readdirSync(new URL('../examples/',import.meta.url)).filter(n=>n.startsWith('r3-')&&n.endsWith('.plan.json'))) {
  const args=JSON.parse(readFileSync(new URL('../examples/'+file,import.meta.url),'utf8'));
  const result=await plan.execute({...args,dryRun:true});
  check(()=>assert.equal(result.status,'SUCCESS',file+': '+JSON.stringify(result)));
 }
 const request=await tools.find(t=>t.name==='catia_g2_solve').execute(g2);
 check(()=>assert.equal(request.status,'SUCCESS'));check(()=>assert.equal(calls,0));
 check(()=>assert.ok(tools.find(t=>t.name==='catia_g2_solve').output.render({},request)[0].text.includes('controlPoints')));
 const catalogTool=tools.find(t=>t.name==='catia_gsd_catalog'),descriptor=await catalogTool.execute({factory:'AddNewBlend'});
 check(()=>assert.ok(catalogTool.output.render({},descriptor)[0].text.includes('SetSupport')));
 const badBridge=new CatiaBridge(normalizeSettings({projectRoot:path.join(temp,'failed'),maxLevel:2},root));
 badBridge.run=async()=>({ok:false,values:{},errors:['update result :: UpdateObject failed'],durationMs:1});
 const failed=await buildToolDefinitions(badBridge,badBridge.settings).find(t=>t.name==='catia_gsd_operation').execute({project:'p',id:'p',...point});
 check(()=>assert.equal(failed.status,'FAILED'));
 check(()=>assert.equal(badBridge.readLedger('p'),null));
 check(()=>assert.ok(failed.diagnostics.findings.some(f=>f.code==='geometry-update-failure')));
} finally {
 if(path.resolve(path.dirname(temp))!==path.resolve(here))throw new Error('Unexpected temp directory');
 rmSync(temp,{recursive:true,force:true});
}
console.log(`PASS: ${checks} r3 offline checks; 145 factory contracts and documented configuration members. No native geometry or G2 certification.`);
