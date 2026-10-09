// SPDX-License-Identifier: GPL-3.0-only
/** Shared boundary construction: native end caps and sidewall precede CloseSurface.
 * No CAD kernel runs here. Native update plus a finite positive volume is still required.
 */
import {vector,finiteNumber} from './validation.js';
import {vbsStr as S,vbsNum as N} from './vbs.js';
import {gsdElement} from './solid-ops.js';
import {apiInput,apiElement} from './gsd-api.js';

const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=a=>Math.hypot(...a);
const unit=a=>{const n=norm(a);if(n<1e-9)throw new Error('zero direction or degenerate plane');return a.map(v=>v/n);};

/** Reject nonplanar, degenerate or self-intersecting polygon caps before any filesystem write. */
export function planarPolygon(input,label='section') {
 if(!Array.isArray(input)||input.length<3||input.length>256)throw new Error(label+' needs 3..256 vertices');
 const points=input.map((p,i)=>vector(p,3,label+'['+i+']'));
 if(norm(sub(points[0],points.at(-1)))<1e-9)points.pop();
 if(points.length<3)throw new Error(label+' needs three distinct vertices');
 const origin=points[0],u=unit(sub(points[1],origin));
 const normalCandidate=points.reduce((sum,p,i)=>cross(sub(p,origin),sub(points[(i+1)%points.length],origin)).map((v,k)=>v+sum[k]),[0,0,0]);
 if(norm(normalCandidate)<1e-8)throw new Error(label+' has zero area');
 const normal=unit(normalCandidate),v=cross(normal,u);
 if(points.some(p=>Math.abs(dot(sub(p,origin),normal))>1e-6))throw new Error(label+' is nonplanar');
 const q=points.map(p=>[dot(sub(p,origin),u),dot(sub(p,origin),v)]);
 const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const on=(a,b,c)=>Math.abs(turn(a,b,c))<1e-8&&[0,1].every(i=>c[i]>=Math.min(a[i],b[i])-1e-8&&c[i]<=Math.max(a[i],b[i])+1e-8);
 const hit=(a,b,c,d)=>turn(a,b,c)*turn(a,b,d)<0&&turn(c,d,a)*turn(c,d,b)<0||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);
 let area=0;
 for(let i=0;i<q.length;i++) {
  const a=q[i],b=q[(i+1)%q.length];
  if(norm(sub(points[i],points[(i+1)%q.length]))<1e-6)throw new Error(label+' contains a zero-length edge');
  area+=a[0]*b[1]-b[0]*a[1];
  for(let j=i+2;j<q.length;j++)if(!(i===0&&j===q.length-1)&&hit(a,b,q[j],q[(j+1)%q.length]))throw new Error(label+' self-intersects');
 }
 if(Math.abs(area)<1e-8)throw new Error(label+' has zero area');
 return {points,normal,area:Math.abs(area)/2};
}
export function closedLoftInput(p) {
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['sections'].includes(k)))throw new Error('closed_loft accepts only sections');
 if(!Array.isArray(p.sections)||p.sections.length<2||p.sections.length>40)throw new Error('sections need 2..40 planar closed polygons');
 const polygons=p.sections.map((s,i)=>planarPolygon(s,'sections['+i+']'));
 if(polygons.some(s=>s.points.length!==polygons[0].points.length))throw new Error('closed sections need equal vertex counts and consistent correspondence');
 // Parallel, monotonically ordered planes avoid caps inside a folded-back or twisted loft.
 const n=polygons[0].normal,offsets=polygons.map(s=>dot(s.points[0],n));
 const sign=Math.sign(offsets[1]-offsets[0]);
 if(!sign||polygons.some(s=>dot(s.normal,n)<1-1e-7)||offsets.slice(1).some((d,i)=>sign*(d-offsets[i])<1e-6))throw new Error('sections must have the same winding on parallel, distinct, monotonically ordered planes');
 return {sections:polygons.map(s=>s.points)};
}
export function cappedExtrudeInput(p) {
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['from','direction','length'].includes(k)))throw new Error('capped_extrude accepts from, direction and length');
 const validated=apiInput({factory:'AddNewExtrude',arguments:[{ref:p.from},finiteNumber(p.length,'length',.001,100000),0,{direction:vector(p.direction,3,'direction')}]});
 return {from:validated.arguments[0].ref,direction:validated.arguments[3].direction,length:validated.arguments[1]};
}
export function solidInternalNames(e) {
 const names=['start_cap','end_wire','end_cap','wall','shell','body'];
 if(e.kind==='closed_loft')names.push(...closedLoftInput(e.params).sections.map((_,i)=>'s'+(i+1)));
 return names.map(n=>e.id+'__'+n);
}
function cappedResult(e,wireStart,wireEnd,wall) {
 const f=(suffix,op,from)=>gsdElement({id:e.id+'__'+suffix,kind:'gsd',params:{op,from,connexion:.001}});
 return [
  f('start_cap','fill',[wireStart]),f('end_cap','fill',[wireEnd]),wall,
  f('shell','join',[e.id+'__start_cap',e.id+'__end_cap',e.id+'__wall']),
  gsdElement({id:e.id,kind:'gsd',params:{op:'solid_close',from:e.id+'__shell'}},'',{newBody:true}),
 ].join('\n');
}
export function closedSolidElement(e) {
 if(e.kind==='capped_extrude') {
  const p=cappedExtrudeInput(e.params),ref={ref:p.from};
  const translate=apiElement({id:e.id+'__end_wire',kind:'gsd_api',params:{factory:'AddNewTranslate',arguments:[ref,{direction:p.direction},p.length]}});
  const wall=apiElement({id:e.id+'__wall',kind:'gsd_api',params:{factory:'AddNewExtrude',arguments:[ref,p.length,0,{direction:p.direction}]}});
  return translate+'\n'+cappedResult(e,p.from,e.id+'__end_wire',wall);
 }
 const p=closedLoftInput(e.params),ids=p.sections.map((_,i)=>e.id+'__s'+(i+1));
 const lines=[`BeginOpenSet "Aero_Contours"`];
 p.sections.forEach((points,i)=>{
  lines.push(`BeginSection ${S(ids[i])}`);
  for(const pt of points)lines.push(`AddSectionPt ${S(ids[i])}, ${pt.map(N).join(', ')}`);
  lines.push(`MakePolygon ${S(ids[i])}, ${S(ids[i])}`);
 });
 lines.push(`UpdateNow ${S(e.id+' closed profiles')}`);
 lines.push(cappedResult(e,ids[0],ids.at(-1),gsdElement({id:e.id+'__wall',kind:'gsd',params:{op:'loft',from:ids}})));
 return lines.join('\n');
}
