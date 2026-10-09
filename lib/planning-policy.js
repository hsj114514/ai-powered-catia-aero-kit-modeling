// SPDX-License-Identifier: GPL-3.0-only
/** Task routing and closure obligations. Offline plans are never native geometry evidence. */
import { apiSources, apiCatalog, apiInput } from './gsd-api.js';
import { gsdSources, gsdInput } from './solid-ops.js';
import { sketchInput } from './sketch-input.js';
import { expectedGeometry } from './ops.js';
import { createHash } from 'node:crypto';
const catalog = new Map(apiCatalog().operations.map(f => [f.method, f]));
export const TASKS = ['planar_profile','planar_closed_profile','spatial_curve','multi_section_surface','surface_trim','solid','closure_repair','projection','intersection','surface_sweep','curve_blend','surface_fillet'];
const repairFactories = new Set(['AddNewJoin','AddNewHealing','AddNewFill','AddNewCloseSurface','AddNewSewSurface','AddNewAdd']);
export function dependencies(s) {
  if (s.kind === 'gsd_api') return apiSources(s.params);
  if (s.kind === 'gsd') return gsdSources(s.params);
  if (s.kind === 'capped_extrude') return [s.params.from];
  if (s.kind === 'flap') return [s.params.parentId];
  return [];
}
function isRepair(s) { return s && (s.kind === 'gsd_api' && repairFactories.has(s.params.factory) || s.kind === 'gsd' && ['join','fill','solid_close'].includes(s.params.op)); }
function dependsOn(from,to,map) {
  const pending=[from],seen=new Set();
  while(pending.length) {
    const id=pending.pop();
    if(id===to)return true;
    if(seen.has(id)||!map.has(id))continue;
    seen.add(id);pending.push(...dependencies(map.get(id)));
  }
  return false;
}
export function buildFingerprint(steps) {
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(stable(steps.map(s=>({id:s.id,kind:s.kind,params:s.kind==='gsd_api'?apiInput(s.params):s.kind==='gsd'?gsdInput({...s.params,from:gsdSources(s.params)}):s.params})).sort((a,b)=>a.id.localeCompare(b.id))))).digest('hex');
}
/** Read only host journal facts for this exact build; model-supplied success flags are not accepted by tools. */
export function repairEvidenceFromAudit(plan,records) {
  const fingerprint=buildFingerprint(plan.steps);
  const record=[...records].reverse().find(r=>r.buildFingerprint===fingerprint&&typeof r.runId==='string'&&r.runId.trim()&&['ok','failed'].includes(r.status));
  if(!record) return undefined;
  const requirements=closurePolicy(plan).findings.filter(r=>r.state==='OPEN'), attempts=[],map=new Map(plan.steps.map(s=>[s.id,s]));
  const reached=plan.steps.filter(s=>isRepair(s)&&record.result?.['attempted_'+s.id]===(s.params.factory??s.params.op));
  // One relevant attempt per obligation, capped before allocating evidence; no quadratic evidence array.
  for(const r of requirements) {
    if(attempts.length>=256)break;
    const s=reached.find(s=>dependsOn(s.id,r.target,map));
    if(s)attempts.push({attemptId:record.runId+'/'+s.id,target:r.target,type:r.type,stepId:s.id,executed:true,outcome:record.result?.['verified_'+s.id]==='true'?'succeeded':'attempted'});
  }
  return {source:'CATIA',runId:record.runId,repairAttempts:attempts,metrics:{}};
}
function planar(points) { return Array.isArray(points) && points.length >= 3 && points.every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) && [0,1,2].some(i => points.every(p => Math.abs(p[i]-points[0][i]) <= 1e-6)); }
function polygon(points) {
  if (!planar(points)) return false;
  const p=points.length>3 && Math.hypot(...points[0].map((v,i)=>v-points.at(-1)[i]))<1e-6 ? points.slice(0,-1) : points;
  // Only an explicit polygon task is an equivalent Sketcher replacement. Planarity alone is insufficient.
  return p.length>=3;
}
export function taskSuitability(s) {
  const t=s.task, f=s.params.factory, k=s.kind;
  if (!t) return k==='gsd_api'||k==='gsd' ? null : 1;
  if (!TASKS.includes(t)) throw new Error('unknown scoring task '+t);
  if (t==='planar_closed_profile') return Number(k==='sketch');
  if (t==='planar_profile') return Number(['section','guide_curve','sketch'].includes(k)||catalog.get(f)?.kind==='curve');
  if (t==='spatial_curve') return Number(['line','guide_curve','section'].includes(k)||catalog.get(f)?.kind==='curve');
  if (t==='multi_section_surface') return Number(['wing','flap','surface','diffuser'].includes(k)||f==='AddNewLoft'||k==='gsd'&&s.params.op==='loft');
  if (t==='surface_trim') return Number(['AddNewHybridTrim','AddNewHybridSplit'].includes(f));
  if (t==='solid') return Number(['closed_loft','capped_extrude'].includes(k)||k==='gsd'&&s.params.op.startsWith('solid_')||catalog.get(f)?.kind==='solid');
  if (t==='closure_repair') return Number(isRepair(s));
  if (t==='projection') return Number(f==='AddNewProject');
  if (t==='intersection') return Number(f==='AddNewIntersection');
  if (t==='surface_sweep') return Number(f?.startsWith('AddNewSweep')===true);
  if (t==='curve_blend') return Number(['AddNewConnect','AddNewBlend'].includes(f));
  return Number(catalog.get(f)?.category==='fillet');
}
export function planningAdvice(steps) {
  const used=new Set(steps.flatMap(dependencies)), findings=[];
  for (const s of steps) {
    if (s.kind==='sketch') {
      const p=sketchInput(s.params);
      if (!p.constraints.length && used.has(s.id)) findings.push({id:s.id,code:'try-dimensional-constraints',tool:'catia_sketch',detail:'Add meaningful supported dimensions/orientations; edit points and lengths together. Native coincidence constraints connect adjacent line endpoints. Do not claim fully constrained or add redundant constraints for reward.'});
    }
    if (s.kind==='guide_curve' && s.task==='planar_closed_profile' && polygon(s.params.points)) findings.push({id:s.id,code:'sketch-first',tool:'catia_sketch',detail:'For an intended polygon, explicitly replan this profile as kind:sketch. A sampled spline cannot be automatically replaced by a polygon without confirming shape intent. Convert world coordinates to the selected plane u/v coordinates; keep its datum origin. Sketcher supports straight polygons/polylines and length/orientation constraints, not native arcs or airfoil splines.'});
    else if (s.kind==='guide_curve' && planar(s.params.points)) findings.push({id:s.id,code:'profile-intent-required',detail:'Declare whether this is a polygon, analytic line/arc or genuine free-form curve. Keep curved airfoils native; use analytic GSD arcs for exact radius while curved Sketcher is unavailable.'});
  }
  return findings;
}
export function planningHabits(steps) {
  const used=new Set(steps.flatMap(dependencies));
  const sketches=steps.filter(s=>s.kind==='sketch'&&used.has(s.id));
  const constraintRate=sketches.length?sketches.filter(s=>sketchInput(s.params).constraints.length>0).length/sketches.length:null;
  // Score distinct declared tasks on connected features, never raw tool counts.
  const groups=new Map();
  for (const s of steps) if (s.task && (used.has(s.id)||dependencies(s).length)) groups.set(s.task,[...(groups.get(s.task)??[]),taskSuitability(s)]);
  const values=[...groups.values()].map(v=>v.reduce((a,b)=>a+b,0)/v.length);
  return {habitMeaningfulConstraints:constraintRate,habitTaskMatchedTools:values.length?values.reduce((a,b)=>a+b,0)/values.length:null};
}
export function validateRequirements(requirements, steps) {
  if (requirements===undefined) return [];
  if (!Array.isArray(requirements)||requirements.length>256) throw new Error('geometryRequirements must be an array of at most 256 obligations');
  const ids=new Set(steps.map(s=>s.id)), seen=new Set();
  return requirements.map(r=>{
    if (!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['target','type','reason'].includes(k))||!ids.has(r.target)||!['closed_wire','closed_shell','solid'].includes(r.type)||typeof r.reason!=='string'||!r.reason.trim()||r.reason.length>1000) throw new Error('closure requirement needs existing target, type and reason');
    const key=r.target+'/'+r.type;
    if (seen.has(key)) throw new Error('duplicate closure requirement');
    seen.add(key);return {...r};
  });
}
export function closurePolicy(plan, config={}, options={}) {
  const steps=plan.steps, map=new Map(steps.map(s=>[s.id,s]));
  const obligations=validateRequirements(plan.geometryRequirements,steps);
  const add=(target,type,reason)=>{if(!obligations.some(r=>r.target===target&&r.type===type))obligations.push({target,type,reason,inferred:true});};
  for(const s of steps) {
    if(s.task==='planar_closed_profile') add(s.id,'closed_wire','Closed planar profile task');
    if(s.kind==='endplate') add(s.id,'closed_shell','Endplate material boundary must close');
    if(s.kind==='capped_extrude') add(s.params.from,'closed_wire','Required by capped_extrude');
    if(s.kind==='gsd'&&s.params.op==='fill'&&gsdSources(s.params).length===1) add(gsdSources(s.params)[0],'closed_wire','Single Fill boundary must close');
    if(s.kind==='gsd'&&s.params.op==='solid_close') add(gsdSources(s.params)[0],'closed_shell','CloseSurface source must be a closed shell');
    if(s.kind==='gsd_api'&&s.params.factory==='AddNewCloseSurface'&&s.params.arguments?.[0]?.ref&&!s.params.arguments[0].brep) add(s.params.arguments[0].ref,'closed_shell','CloseSurface source must be a closed shell');
    if(s.kind==='gsd_api'&&s.params.factory==='AddNewFill') {
      const bounds=(s.params.configure??[]).filter(a=>a.method==='AddBound');
      if(bounds.length===1&&bounds[0].arguments?.[0]?.ref&&!bounds[0].arguments[0].brep) add(bounds[0].arguments[0].ref,'closed_wire','Single Fill boundary must close');
    }
    if(['closed_loft','capped_extrude'].includes(s.kind)||s.kind==='gsd'&&s.params.op.startsWith('solid_')||catalog.get(s.params.factory)?.kind==='solid') add(s.id,'solid','Solid output contract');
  }
  if(obligations.length>2304) throw new Error('too many closure obligations');
  const ev=options.evidence, live=ev?.source==='CATIA'&&typeof ev.runId==='string'&&!!ev.runId.trim();
  const attempts=live&&Array.isArray(ev.repairAttempts)?ev.repairAttempts:[];
  if(attempts.length>256) throw new Error('too many repair attempts');
  const findings=obligations.map(r=>{
    const s=map.get(r.target), p=s.params, kind=expectedGeometry(s);let state='UNKNOWN',basis='Native closure evidence unavailable';
    const typeMismatch=r.type==='closed_wire'&&!['curve','auto'].includes(kind)||r.type==='closed_shell'&&!['surface','auto'].includes(kind)||r.type==='solid'&&!['solid','auto'].includes(kind);
    if(typeMismatch){state='OPEN';basis='Final target geometry type does not satisfy the declared output contract';}
    if(r.type==='closed_wire'&&s.kind==='sketch') {const sketch=sketchInput(p);state=sketch.closed?'CLOSED_INPUT':'OPEN';basis=sketch.closed?'Validated polygon; native coincidence/update unverified':'Input builder explicitly creates an open Sketcher profile';}
    if(r.type==='closed_wire'&&['line','guide_curve'].includes(s.kind)&&p.closed!==true){state='OPEN';basis='Input builder creates an open wire';}
    if(r.type==='solid'&&expectedGeometry(s)!=='solid'&&expectedGeometry(s)!=='auto'){state='OPEN';basis='Final target is not a solid constructor';}
    if(r.type==='closed_shell'&&s.kind==='surface'){state='OPEN';basis='Surface loft does not include end caps, even with closed sections';}
    const measurement=live?ev.closure?.[r.target]?.[r.type]:null;
    if(!typeMismatch&&measurement && measurement.updated===true && typeof measurement.measurementId==='string'&&measurement.measurementId.trim()) {
      if(measurement.closed===false) {state='OPEN';basis='Attributed native inspection reports an open result';}
      // Positive volume/area alone cannot certify watertightness, orientation or connectivity.
      else if(measurement.closed===true&&measurement.boundaryCount===0&&measurement.manifold===true&&measurement.oriented===true&&measurement.connectedComponents===1&&(r.type!=='solid'||Number.isFinite(measurement.volumeMm3)&&measurement.volumeMm3>0&&measurement.bodyCount===1)) {state='CLOSED_NATIVE';basis='Attributed closure inspection contract';}
    }
    const repair=state==='OPEN'?attempts.find(a=>typeof a.attemptId==='string'&&!!a.attemptId.trim()&&a.target===r.target&&a.type===r.type&&['attempted','failed','succeeded'].includes(a.outcome)&&a.executed===true&&isRepair(map.get(a.stepId))&&dependencies(map.get(a.stepId)).length>0&&dependsOn(a.stepId,r.target,map)):null;
    return {...r,state,basis,repairMitigation:repair?(config.closureRepairMitigation??.25):0,repairAttemptId:repair?.attemptId??null,nativeVerified:state==='CLOSED_NATIVE',deliveryReady:state==='CLOSED_NATIVE'};
  });
  // Repeated joins and duplicate attempts never compound mitigation. Planned attempts earn no relief.
  const open=findings.filter(r=>r.state==='OPEN'), unknown=findings.filter(r=>r.state==='UNKNOWN'||r.state==='CLOSED_INPUT');
  const penalty=open.length?(config.closurePenaltyCapPoints??6)*open.reduce((n,r)=>n+1-r.repairMitigation,0)/open.length:0;
  const unknownPenalty=unknown.length?(config.closureUnknownPenaltyPoints??1):0;
  return {findings,openCount:open.length,unknownCount:unknown.length,requiredCount:findings.length,requirementsDeclared:plan.geometryRequirements!==undefined,penaltyPoints:penalty+unknownPenalty,readyForDelivery:findings.length>0&&findings.every(r=>r.deliveryReady),evidenceScope:live?'caller-attributed-CATIA-contract':'offline-plan-only',note:'Evidence provenance is a caller contract, not independently authenticated. Missing declarations cannot certify delivery. Intended footplate openings are not closed-shell obligations; close their material perimeter, preserve the opening.'};
}
