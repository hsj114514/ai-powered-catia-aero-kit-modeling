// SPDX-License-Identifier: GPL-3.0-only
/** Offline GSD/solid contract checks; live specimens are a separate opt-in script. */
import assert from 'node:assert/strict';
import { buildToolDefinitions } from '../lib/tools.js';
import { KIND_LEVEL } from '../lib/ops.js';
import { GSD_OPS, gsdElement, gsdInput, mirrorParams, probeBody } from '../lib/solid-ops.js';
let checks=0;
const check=(fn)=>{fn();checks++;};
const calls=[];
const bridge={settings:{maxLevel:3},run:async req=>{calls.push(req);return {ok:true,values:{},errors:[]};}};
const defs=buildToolDefinitions(bridge,{});
for(const name of ['catia_api_probe','catia_gsd_feature','catia_mirror_element','catia_surface','catia_model_plan']) check(()=>assert.ok(defs.some(t=>t.name===name)));
check(()=>assert.equal(KIND_LEVEL.gsd,1));
check(()=>assert.equal(KIND_LEVEL.surface,1));
check(()=>assert.equal(Object.keys(GSD_OPS).length,7));
check(()=>assert.deepEqual(defs.find(t=>t.name==='catia_gsd_feature').parameters.required,['project','id','op','from']));
check(()=>assert.deepEqual(defs.find(t=>t.name==='catia_surface').parameters.required,['project','id','sections']));
await defs.find(t=>t.name==='catia_api_probe').execute({project:'p'});
check(()=>assert.equal(calls[0].level,1));
const probe=probeBody();
check(()=>assert.ok(probe.includes('gDoc.Close')));
check(()=>assert.ok(!probe.includes('SaveAs')));
check(()=>assert.equal((probe.match(/Emit "api_[^"]+", "verified"/g)||[]).length,7));
const procedures=[...probe.matchAll(/^Sub (BuildGsd_[a-z0-9]+)\(/gm)].map(m=>m[1]);
check(()=>assert.equal(new Set(procedures).size,procedures.length,'probe procedures must not shadow each other'));
check(()=>assert.ok(!probe.includes('other codes => member exists')));
for(const value of [null,true,'3',NaN,Infinity]) check(()=>assert.throws(()=>gsdInput({op:'offset',from:['a'],distance:value}),/finite number/));
for(const value of [null,[],['join'],'toString','sweep']) check(()=>assert.throws(()=>gsdInput({op:value,from:['a','b']}),/op must be/));
check(()=>assert.throws(()=>gsdInput({op:'join',from:['a','a']}),/repeat/));
check(()=>assert.throws(()=>gsdInput({op:'join',from:['a']}),/must list/));
check(()=>assert.throws(()=>gsdInput({op:'offset',from:['a'],distance:2,bothSides:true}),/two signed/));
check(()=>assert.throws(()=>gsdInput({op:'offset',from:['a'],distance:2,bothSides:'true'}),/boolean/));
check(()=>assert.throws(()=>gsdInput({op:'offset',from:['a" & Execute'],distance:2}),/unsafe characters/));
check(()=>assert.throws(()=>gsdInput({op:'extrude',from:['a'],dir:['X'],limit1:2}),/dir must/));
check(()=>assert.throws(()=>gsdInput({op:'solid_thick',from:['a'],offset1:null}),/finite number/));
check(()=>assert.equal(gsdInput({op:'solid_thick',from:['a']}).offset1,2));
check(()=>assert.equal(gsdInput({op:'join',from:['a','b']}).connexion,0.001));
for(const op of Object.keys(GSD_OPS)){
 const args=op==='join'||op==='loft'?{op,from:['a','b']}:op==='extrude'?{op,from:['a'],dir:'Z',limit1:5}:op==='offset'?{op,from:['a'],distance:-2}:{op,from:['a']};
 const script=gsdElement({id:'result',kind:'gsd',params:gsdInput(args)});
 check(()=>assert.ok(script.includes('If gFatal <> "" Then Exit Sub')));
 check(()=>assert.ok(script.includes('VerifyFeature "result"')));
 check(()=>assert.ok(script.includes('gTrash.Add')));
 check(()=>assert.ok(script.includes('gFeats.Add "result", feat')));
 check(()=>assert.ok(script.includes('gPart.UpdateObject feat')));
}
const fragment=args=>gsdElement({id:'result',kind:'gsd',params:gsdInput(args)});
check(()=>assert.ok(fragment({op:'join',from:['a','b']}).includes('feat.SetDeviation')));
check(()=>assert.ok(!fragment({op:'join',from:['a','b']}).includes('SetConnexion')));
check(()=>assert.ok(fragment({op:'offset',from:['a'],distance:-2}).includes('AddNewOffset(refs(0), 2.000000, True, 0.001)')));
for(const [dir,vector]of [['X','1.000000, 0.000000, 0.000000'],['-X','-1.000000, 0.000000, 0.000000'],['Y','0.000000, 1.000000, 0.000000'],['-Y','0.000000, -1.000000, 0.000000'],['Z','0.000000, 0.000000, 1.000000'],['-Z','0.000000, 0.000000, -1.000000']]){
 const script=fragment({op:'extrude',from:['a'],dir,limit1:5});
 check(()=>assert.ok(script.includes('AddNewDirectionByCoord('+vector+')')));
 check(()=>assert.ok(script.includes('AddNewExtrude(refs(0), 5.000000, 0.000000, direction)')));
}
check(()=>assert.ok(fragment({op:'solid_thick',from:['a'],offset1:2,offset2:1}).includes('AddNewThickSurface(refs(0), 1, 2.000000, 1.000000)')));
check(()=>assert.ok(!fragment({op:'solid_thick',from:['a']}).includes('AppendHybridShape')));
check(()=>assert.equal(mirrorParams('point',{x:1,y:2,z:3}).z,-3));
check(()=>assert.equal(mirrorParams('line',{z1:5,z2:-5}).z2,5));
check(()=>assert.equal(mirrorParams('guide_curve',{points:[[0,0,7]]}).points[0][2],-7));
check(()=>assert.equal(mirrorParams('endplate',{z:670,thickness:2.3}).z,-672.3));
const mirrored=mirrorParams('wing',{span:140,zStart:530,chordRoot:330,chordTip:300,yOffset:7,dihedralDeg:2,sweepDeg:0,twist:0});
check(()=>assert.equal(mirrored.zStart,-670));
check(()=>assert.equal(mirrored.chordRoot,300));
check(()=>assert.ok(Math.abs(mirrored.yOffset-(7+140*Math.tan(2*Math.PI/180)))<1e-9));
check(()=>assert.throws(()=>mirrorParams('wing',{sweepDeg:3}),/swept/));
check(()=>assert.throws(()=>mirrorParams('wing',{twist:3}),/twisted/));
check(()=>assert.throws(()=>mirrorParams('diffuser',{}),/not implemented/));
console.log('PASS: '+checks+' GSD/solid contracts and signature/axis/validation regressions.');
