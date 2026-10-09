// SPDX-License-Identifier: GPL-3.0-only
/** Exact straight-profile routing only. Never fits or flattens a curved source. */
import { sketchInput, SKETCH_AXES } from './sketch-input.js';
import { surfaceContours } from './ops.js';
import { dependencies } from './planning-policy.js';

export function routeAudit(steps) {
  const consumers=new Map();
  for(const s of steps) for(const id of dependencies(s)) consumers.set(id,[...(consumers.get(id)??[]),s.id]);
  const sketches=steps.filter(s=>s.kind==='sketch').map(s=>{
    const p=sketchInput(s.params);
    return {id:s.id,plane:p.plane,closed:p.closed,edges:p.edgeCount,requestedConstraints:p.constraints.map(c=>c.type),automaticCoincidences:p.closed?p.edgeCount:Math.max(0,p.edgeCount-1),consumedBy:consumers.get(s.id)??[]};
  });
  return {scope:'planned-code-route-only',sketchCount:sketches.length,consumedSketchCount:sketches.filter(s=>s.consumedBy.length).length,requestedConstraintCount:sketches.reduce((n,s)=>n+s.requestedConstraints.length,0),sketches,
    sampledCurveIds:steps.filter(s=>['section','wing','flap'].includes(s.kind)||s.kind==='guide_curve'&&s.params.points?.length>2||s.kind==='surface'&&s.params.sections?.some(c=>c.length>2)).map(s=>s.id),
    note:'A plan is not an execution record. Native sketch counts and endpoint verification are returned separately after CATIA execution. Curved airfoils remain curves.'};
}

export function preparePlan(steps, options={}) {
  if(!Array.isArray(steps)||steps.length<1||steps.length>2048)throw new Error('steps must contain 1..2048 elements');
  const mode=options.routeMode??'sketch_first';
  if(!['sketch_first','literal'].includes(mode))throw new Error('routeMode must be sketch_first or literal');
  if(mode==='literal'&&(typeof options.routeReason!=='string'||!options.routeReason.trim()||options.routeReason.length>1000))throw new Error('literal route requires a concrete routeReason');
  const ids=new Set(steps.map(s=>s?.id)),out=[],changes=[];
  for(const original of steps) {
    if(!original||typeof original!=='object'||Array.isArray(original)||!original.params||typeof original.params!=='object'||Array.isArray(original.params))throw new Error('invalid plan step');
    const s=structuredClone(original), p=s.params;
    if(mode==='sketch_first'&&s.kind==='surface') {
      const sections=surfaceContours(p),flat=sections.flat();
      const plane=Object.entries(SKETCH_AXES).find(([,a])=>flat.every(pt=>Math.abs(pt[a.normal]-flat[0][a.normal])<=1e-9))?.[0];
      if(p.closed!==true&&sections.every(c=>c.length===2)&&plane) {
        // Only documented surface parameters are eligible; unknown extensions require literal review.
        if(Object.keys(p).some(k=>!['sections','closed'].includes(k))) {out.push(s);continue;}
        const refs=[];
        sections.forEach((points,i)=>{
          const id=s.id+'__sketch_'+(i+1);
          if(id.length>96)throw new Error('prepared sketch id exceeds 96 characters: '+id);
          if(ids.has(id))throw new Error('prepared sketch id collision: '+id);
          ids.add(id);refs.push(id);
          const origin=points[0],a=SKETCH_AXES[plane],delta=points[1].map((n,k)=>n-origin[k]);
          const uv=[delta.reduce((n,v,k)=>n+v*a.u[k],0),delta.reduce((n,v,k)=>n+v*a.v[k],0)];
          const constraints=[{type:'length',edge:0,value:Math.hypot(...uv)}];
          if(Math.abs(uv[1])<=1e-9)constraints.push({type:'horizontal',edge:0});
          else if(Math.abs(uv[0])<=1e-9)constraints.push({type:'vertical',edge:0});
          const sketch={id,kind:'sketch',task:'planar_profile',...(s.part?{part:s.part}:{}),purpose:'Exact line section consumed by '+s.id,params:{plane,origin,points:[[0,0],uv],closed:false,constraints}};
          sketchInput(sketch.params);out.push(sketch);
        });
        out.push({...s,kind:'gsd',task:s.task??'multi_section_surface',params:{op:'loft',from:refs}});
        changes.push({id:s.id,from:'surface/two-point-spline-sections',to:'constrained-Sketcher-lines/GSD-Loft',profiles:refs,geometry:'same straight endpoints and section order; native equivalence/update unverified'});
        continue;
      }
    }
    out.push(s);
  }
  if(out.length>2048)throw new Error('prepared plan exceeds 2048 elements; split the plan into meaningful parts');
  return {steps:out,routeMode:mode,routeReason:options.routeReason??null,changes,routeAudit:routeAudit(out),nativeVerified:false};
}
