// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { elementFragment, elementGeometry, EDITABLE, expectedGeometry } from '../lib/ops.js';
import { sketchInput } from '../lib/sketch-input.js';
import { PRELUDE } from '../lib/vbs.js';
import { isAvailable, SKETCHER_STATUS, documentedSequence } from '../lib/catia/sketcher.js';
import { requiresHumanReview } from '../lib/human-review.js';
const points=[[0,0],[100,0],[100,50],[0,50]],origin=[10,20,30];
const sketch={id:'Profile',kind:'sketch',params:{points,origin,constraint:{type:'length',value:100}}};
assert.equal(isAvailable(),true);assert.match(SKETCHER_STATUS,/NOT_LIVE_VERIFIED/);
assert.ok(documentedSequence().includes('Body.Sketches.Add(plane)'));
assert.equal(expectedGeometry(sketch),'curve');assert.ok(EDITABLE.sketch.includes('points'));
assert.equal(requiresHumanReview({steps:[sketch]}).required,false);
for(const [plane,end] of [['XY',[110,70,30]],['YZ',[10,120,80]],['ZX',[60,20,130]]]) {
 const e={...sketch,params:{...sketch.params,plane}};
 const g=elementGeometry(e);assert.deepEqual(g.bounds.min,origin);assert.deepEqual(g.bounds.max,end);assert.equal(g.boundsCertified,true);
}
assert.equal(sketchInput({points:[...points,points[0]]}).points.length,4);
const frag=elementFragment(sketch);
for(const needle of ['MakeSketch','axis(8)','xs(1) = 100.000000','edges(0) = 0','UpdateNow']) assert.ok(frag.includes(needle));
const dense=elementFragment({id:'Dense',kind:'sketch',params:{points:Array.from({length:256},(_,i)=>[100*Math.cos(2*Math.PI*i/256),100*Math.sin(2*Math.PI*i/256)])}});
assert.ok(dense.split('\n').every(l=>l.length<1024),'no overlong VBScript array lines');
for(const p of [{points:[[0,0],[1,0]]},{points,plane:'AB'},{points:[[0,0],[1,0],[1,0],[0,1]]},{points:[[0,0],[1,1],[1,0],[0,1]]},{points,constraint:{value:50}},{points,constraints:[{edge:0,value:100},{edge:0,value:100}]},{points,constraint:{edge:9,value:100}},{points,constraint:{type:'tangency',value:100}},{points,unexpected:1}]) assert.throws(()=>sketchInput(p));
const native=PRELUDE.slice(PRELUDE.indexOf('Sub MakeSketch('));
for(const needle of ['gPart.MainBody.Sketches.Add(plane)','gTrash.Add gTrash.Count, sk','CreateReferenceFromObject(lines(cEdges(i)))','AddMonoEltCst(5, refLine)','sk.CloseEdition','sk.GetAbsoluteAxisData actualAxis','ReadSketchEnds lines(i), ends','Emit "feature_" & nm']) assert.ok(native.includes(needle),needle);
assert.equal(native.slice(native.indexOf('Set f2d = sk.OpenEdition'),native.indexOf('sk.CloseEdition')).includes('Exit Sub'),false,'errors must close edition');
assert.ok(PRELUDE.includes('For Each s In b.Sketches'));assert.ok(PRELUDE.includes('For Each s In h.HybridSketches'));assert.ok(PRELUDE.includes('amount = SketchPerimeter(obj, feature)'));
console.log('PASS: polygon validation, explicit XYZ placement, supported editing, native references/enum, bounded scripts, cleanup and persisted lookup. No native CATIA test.');
