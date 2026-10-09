// SPDX-License-Identifier: GPL-3.0-only
/** Defines offline perturbations; never performs Modify/Update/Validate/Rollback itself. */
export const REBUILD_FLOW=['Modify','Update','Validate','Record','Rollback'];
export const PERTURBATIONS=[{parameter:'chord',mode:'relative',deltas:[-.10,-.05,.05,.10]},{parameter:'aoa',mode:'absolute-deg',deltas:[-3,-1,1,3]},{parameter:'span',mode:'relative',deltas:[-.10,-.05,.05,.10]},{parameter:'twist',mode:'absolute-deg',deltas:[-3,-1,1,3]},{parameter:'gap',mode:'relative',deltas:[-.20,-.10,.10,.20]}];
const STATUS=new Set(['not-run','updated','pass','failed']);
export function perturbationGrid(){return PERTURBATIONS.flatMap(g=>g.deltas.map(delta=>({parameter:g.parameter,delta,mode:g.mode})));}
export function computeRebuildSuccessRate(records=[]){
  if(!Array.isArray(records))throw new Error('rebuild records must be an array');
  const ids=new Set();let executed=0,succeeded=0,unattributed=0;
  for(const r of records){if(!r||!STATUS.has(r.status))throw new Error('invalid rebuild status');if(r.status==='not-run')continue;
    if(r.source!=='CATIA'||typeof r.runId!=='string'||!r.runId.trim()){unattributed++;continue;}
    if(ids.has(r.runId))throw new Error('duplicate rebuild runId');ids.add(r.runId);executed++;
    if(r.status==='pass'&&r.updated===true&&r.validated===true&&r.rolledBack===true)succeeded++;
  }
  return {total:records.length,executed,succeeded,unattributed,rate:executed?Number((succeeded/executed).toFixed(4)):null,note:'Attributable CATIA attempts only; success requires Update, Validate and Rollback. Caller evidence is not independently authenticated.'};
}
export function recordRebuild(parameter,delta,status,detail='',evidence={}){
  if(!PERTURBATIONS.some(g=>g.parameter===parameter)||typeof delta!=='number'||!Number.isFinite(delta)||!STATUS.has(status))throw new Error('invalid rebuild record');
  return {...evidence,parameter,delta,status,detail,at:new Date().toISOString()};
}
