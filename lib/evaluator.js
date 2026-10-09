// SPDX-License-Identifier: GPL-3.0-only
import { validateOperationSources } from './operation-contract.js';
/** Bounded plan heuristics. A score never overrides a hard rejection or certifies geometry. */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KIND_LEVEL,EDITABLE,orderedElements,elementFragment,elementContext} from './ops.js';
import {apiCatalog} from './gsd-api.js';
import {evaluateRules,candidateForElement,loadRules} from './rules-engine.js';
import {hardReject} from './failure-taxonomy.js';
import { evaluateHabitPriors, HABIT_KEYS } from './habit-priors.js';
import { TASKS, taskSuitability, planningAdvice, closurePolicy, validateRequirements } from './planning-policy.js';
const HABITS=HABIT_KEYS;
const REWARDS=['toolSuitability','semanticReference','parameterization','canonicalPath','surfaceQuality','lowTopologyRisk','historicalReliability','buildSuccess','updateSuccess','rebuildSuccess',...HABIT_KEYS];
const PENALTIES=['generatedTopologyDependency','fragileChain','unnecessaryComplexity','fillAbuse','extractAbuse','toolMisuse','continuityMismatch','hardcoding','historicalFailure','unexplainedComplexity'];
const LIVE=['surfaceQuality','historicalReliability','buildSuccess','updateSuccess','rebuildSuccess','historicalFailure'];
const factories=new Map(apiCatalog().operations.map(f=>[f.method,f]));
const clamp=x=>Math.max(0,Math.min(1,x));
const named=id=>typeof id==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(id)&&!/^(F|S|P|L|PL|G)_?\d+$/.test(id);
const GENERATED=/(?:Edge|Face|Vertex)[.:()]\d|(?:Edge|Face|Vertex):\(/i;
const INDEXED=/(?:hybridShape|geometry)\(\d+\)|\.\d+\)/i;
function validateWeights(config) {
  const weights=config.metrics??config;
  for (const [k,v] of Object.entries(weights)) {
    if (![...REWARDS,...PENALTIES].includes(k)) throw new Error('unknown scoring metric '+k);
    if (typeof v!=='number'||!Number.isFinite(v)||(REWARDS.includes(k)?v<0:v>0)) throw new Error('invalid weight/sign for '+k);
  }
  for (const k of ['fillAllowance','extractAllowance','fragileChainScale','generatedDependencyScale']) if(config[k]!==undefined&&(typeof config[k]!=='number'||!Number.isFinite(config[k])||config[k]<(k.endsWith('Scale')?1:0))) throw new Error('invalid scoring setting '+k);
  if(config.topologyRiskWeights) for(const v of Object.values(config.topologyRiskWeights)) if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1) throw new Error('topology risk weight must be in [0,1]');
  const habitWeights=HABIT_KEYS.reduce((sum,k)=>sum+(weights[k]??0),0);
  if (HABIT_KEYS.some(k=>(weights[k]??0)>0.5)||habitWeights>2) throw new Error('habit weights must be small: <=0.5 each and <=2 combined');
  if(config.habitBonusCapPoints!==undefined&&(!Number.isFinite(config.habitBonusCapPoints)||config.habitBonusCapPoints<0||config.habitBonusCapPoints>3)) throw new Error('habitBonusCapPoints must be in [0,3]');
  for (const [key,min,max] of [['closurePenaltyCapPoints',4,10],['closureUnknownPenaltyPoints',0,2],['closureRepairMitigation',0,.25]]) if(config[key]!==undefined&&(!Number.isFinite(config[key])||config[key]<min||config[key]>max)) throw new Error(key+' outside allowed range');
  return config;
}
export function loadWeights(file,active=new Set()) {
  const resolved=path.resolve(file instanceof URL?fileURLToPath(file):file);
  if(active.has(resolved)||active.size>=16) throw new Error('cyclic/deep scoring inheritance');
  const next=new Set([...active,resolved]),own=JSON.parse(readFileSync(resolved,'utf8'));let base={};
  if(own.extends!==undefined) {if(typeof own.extends!=='string'||!/^[A-Za-z0-9_.-]+\.json$/.test(own.extends)) throw new Error('extends must name a sibling JSON file');base=loadWeights(path.join(path.dirname(resolved),own.extends),next);}
  const {extends:inheritance,...config}=own;
  return validateWeights({...base,...config,metrics:{...base.metrics,...config.metrics},topologyRiskWeights:{...base.topologyRiskWeights,...config.topologyRiskWeights}});
}
/** Only actual dependency fields; descriptions and decorative labels cannot create references. */
export function planReferences(step) {
  const refs=[],p=step.params??{},add=(ref,brep)=>{if(typeof ref==='string')refs.push({ref,brep});};
  const visit=v=>{if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=='object')return;if(typeof v.ref==='string')add(v.ref,v.brep);else Object.values(v).forEach(visit);};
  if(step.kind==='gsd_api'){visit(p.arguments);visit(p.configure);add(p.bodySource);}
  if(step.kind==='flap')add(p.parentId);
  if(['gsd','capped_extrude'].includes(step.kind)) for(const id of Array.isArray(p.from)?p.from:[p.from])add(id);
  return refs;
}
export function evaluateBuildPlan(plan,componentWeights,options={}) {
  const config=validateWeights(componentWeights??{}),weights=config.metrics??config,steps=Array.isArray(plan?.steps)?plan.steps:[];
  const ruleSet=options.rules??loadRules();
  const rejects=[],notes=[],map=new Map(),rules=evaluateRules(options.candidate??{},ruleSet);rejects.push(...rules.rejects);
  if(!steps.length||steps.length>2048)rejects.push(hardReject('H04','plan needs 1..2048 steps'));
  for(const s of steps){
    if(!s||typeof s.id!=='string'||!s.id||map.has(s.id)||!s.params||typeof s.params!=='object'||Array.isArray(s.params)){rejects.push(hardReject('H05','invalid/duplicate step'));continue;}
    map.set(s.id,s);
    if(s.task!==undefined&&!TASKS.includes(s.task))rejects.push(hardReject('H05','unknown scoring task '+s.task));
    if(!Object.hasOwn(KIND_LEVEL,s.kind)||s.kind==='gsd_api'&&!factories.has(s.params.factory))rejects.push(hardReject('H10','unknown element/tool '+s.kind+'/'+s.params.factory));
    rejects.push(...evaluateRules(candidateForElement(s),ruleSet).rejects.map(r=>({...r,element:s.id})));
  }
  const references=new Map(steps.filter(s=>map.has(s?.id)).map(s=>[s.id,planReferences(s)])),memo=new Map(),active=new Set();
  function depth(id){
    if(memo.has(id))return memo.get(id);
    if(active.has(id)||active.size>64)throw new Error('cyclic/deep dependency');active.add(id);
    const ownRisk=references.get(id).some(r=>r.brep||GENERATED.test(r.ref)||INDEXED.test(r.ref));let chain=ownRisk?1:0;
    for(const r of references.get(id)){if(!map.has(r.ref)){rejects.push(hardReject('H04','missing dependency '+r.ref));continue;}const d=depth(r.ref);chain=Math.max(chain,ownRisk?1+d:0);}
    active.delete(id);memo.set(id,chain);return chain;
  }
  try{for(const id of map.keys())depth(id);}catch(e){rejects.push(hardReject('H05',e.message));}
  if(!rejects.length) {
    try { validateRequirements(plan.geometryRequirements,steps); const elements=Object.fromEntries(map),ordered=orderedElements(elements);let chars=0;for(const step of ordered){validateOperationSources(step,elements);chars+=elementFragment(step,elementContext(step,elements)).length;if(chars>8388608)throw new Error('plan exceeds generated script budget');} }
    catch(error){rejects.push(hardReject('H05',error.message));}
  }
  if(rejects.length)return {status:'BLOCKED',eligible:false,total:null,score100:null,breakdown:[],rejects,rules,screeningOnly:true};
  const kinds=steps.reduce((a,s)=>{a[s.kind]=(a[s.kind]??0)+1;return a;},Object.create(null)),refs=[...references.values()].flat(),risky=refs.filter(r=>r.brep||GENERATED.test(r.ref)||INDEXED.test(r.ref)),riskTable=config.topologyRiskWeights??{};
  const risk=r=>{
    if(INDEXED.test(r.brep??r.ref))return riskTable.indexTopology??1;
    if(r.brep||GENERATED.test(r.ref))return /Face/i.test(r.brep??r.ref)?riskTable.generatedFace??.9:riskTable.generatedEdge??.8;
    const s=map.get(r.ref),key=s.kind==='plane'?'namedPlane':s.kind==='point'?'namedPoint':['section','sketch','axis_system'].includes(s.kind)?'namedSection':s.kind==='guide_curve'?'namedGuide':s.params.factory==='AddNewIntersection'?'intersection':s.params.factory==='AddNewBoundary'?'boundary':/Extract/.test(s.params.factory??'')?'extract':'explicitCurve';return riskTable[key]??0;
  };
  const shapeSteps=steps.filter(s=>!['point','line','plane','guide_curve','section','sketch','axis_system'].includes(s.kind)&&!(s.kind==='gsd_api'&&factories.get(s.params.factory).kind==='reference'));
  const paramSteps=steps.filter(s=>EDITABLE[s.kind]),parametric=paramSteps.filter(s=>(s.kind==='sketch'?Array.isArray(s.params.points):EDITABLE[s.kind].some(k=>typeof s.params[k]==='number'&&Number.isFinite(s.params[k])))).length,parameterization=paramSteps.length?parametric/paramSteps.length:0;
  const canonical=steps.some(s=>s.kind==='gsd_api'&&s.params.factory==='AddNewLoft'&&references.get(s.id).some(r=>['section','sketch'].includes(map.get(r.ref)?.kind))&&references.get(s.id).some(r=>map.get(r.ref)?.kind==='guide_curve'));
  const fillCount=steps.filter(s=>s.params.factory==='AddNewFill'||s.kind==='gsd'&&s.params.op==='fill').length,extractCount=steps.filter(s=>/Extract/.test(s.params.factory??'')).length;
  const labels=s=>{const v=s.function??s.purpose??s.params.function??s.params.purpose;return typeof v==='string'&&v.trim();};
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).filter(k=>!['parameter','drivenBy','function','purpose','explained'].includes(k)).sort().map(k=>[k,stable(v[k])])):v;
  const payloads=new Set();let duplicates=0;
  for(const s of shapeSteps){const key=JSON.stringify([s.kind,stable(s.params)]);if(payloads.has(key))duplicates++;payloads.add(key);}
  // Include consumed profiles and explicit tasks; the old shape-only filter hid Sketcher choices.
  const usedProfiles=new Set(refs.map(r=>r.ref));
  const assessmentSteps=steps.filter(s=>shapeSteps.includes(s)||s.task!==undefined||usedProfiles.has(s.id)&&['sketch','section','guide_curve'].includes(s.kind));
  const taskScores=assessmentSteps.map(taskSuitability);
  const assessed=taskScores.filter(v=>v!==null);
  const metrics={toolSuitability:taskScores.some(v=>v===null)?null:assessed.length?assessed.reduce((a,b)=>a+b,0)/assessed.length:0,semanticReference:refs.length?refs.filter(r=>!r.brep&&named(r.ref)).length/refs.length:steps.filter(s=>named(s.id)).length/steps.length,
    parameterization,canonicalPath:canonical?1:0,lowTopologyRisk:1-(refs.length?refs.reduce((sum,r)=>sum+risk(r),0)/refs.length:0),generatedTopologyDependency:clamp(risky.length/(config.generatedDependencyScale??4)),fragileChain:clamp(Math.max(0,...memo.values())/(config.fragileChainScale??5)),
    unnecessaryComplexity:shapeSteps.length?duplicates/shapeSteps.length:0,fillAbuse:clamp(Math.max(0,fillCount-(config.fillAllowance??2))/((config.fillAllowance??2)+1)),extractAbuse:clamp(Math.max(0,extractCount-(config.extractAllowance??2))/((config.extractAllowance??2)+1)),
    toolMisuse:assessed.length?assessed.filter(v=>v===0).length/assessed.length:null,continuityMismatch:null,hardcoding:1-parameterization,unexplainedComplexity:config.requireFunctionLabels===true&&shapeSteps.length?shapeSteps.filter(s=>!labels(s)).length/shapeSteps.length:0};
  const evidence=options.evidence,hasEvidence=evidence?.source==='CATIA'&&typeof evidence.runId==='string'&&!!evidence.runId.trim();
  for(const k of LIVE){const supplied=evidence?.metrics?.[k]??options[k];if(supplied!==undefined&&supplied!==null&&(typeof supplied!=='number'||!Number.isFinite(supplied)||supplied<0||supplied>1))throw new Error(k+' must be in [0,1]');metrics[k]=hasEvidence?evidence.metrics?.[k]??null:null;}
  const required=options.requiredContinuity??config.requiredContinuity?.[options.continuitySemantic],actual=hasEvidence?evidence.actualContinuity:undefined;
  if(required!==undefined&&![0,1,2].includes(required)||actual!==undefined&&![0,1,2].includes(actual))throw new Error('continuity must be G0/G1/G2');
  if(required===0)metrics.continuityMismatch=0;else if(required!==undefined&&actual!==undefined)metrics.continuityMismatch=clamp((required-actual)/2);
  if(options.intentionalG0&&required>0)notes.push('intentionalG0 cannot override a semantic G1/G2 requirement');
  notes.push('Closure penalties are subtracted from score100, not raw total; compare score100 only under identical weights, requirements and evidence scope. An empty/missing closure declaration cannot establish delivery readiness.');
  notes.push('Parameterization means editable ledger values, not CATIA formula bindings. Suitability and duplicate geometry are plan heuristics.');
  if(!hasEvidence)notes.push('No attributable CATIA evidence; live metrics remain null.');
  const closure=closurePolicy(plan,config,options),toolAdvice=planningAdvice(steps);
  const habitMetrics=evaluateHabitPriors(plan,options); for(const k of HABIT_KEYS) if(habitMetrics[k]!==undefined) metrics[k]=habitMetrics[k];
const breakdown=[],missingMetrics=[];let total=0,habitTotal=0,habitWeight=0,positive=0,negative=0,availableWeight=0,configuredWeight=0;
  for(const [k,v]of Object.entries(metrics)){const weight=weights[k]??0;configuredWeight+=Math.abs(weight);if(v===null){missingMetrics.push(k);breakdown.push({metric:k,value:null,weight,contribution:null,note:HABIT_KEYS.includes(k)?'habit not applicable or evidence unavailable':'no real CATIA/measurement input - not assumed'});continue;}const contribution=v*weight;if(HABIT_KEYS.includes(k)){habitTotal+=contribution;habitWeight+=weight;}else total+=contribution;availableWeight+=Math.abs(weight);if(!HABIT_KEYS.includes(k)){positive+=Math.max(weight,0);negative+=Math.max(-weight,0);}breakdown.push({metric:k,value:Number(v.toFixed(4)),weight,contribution:Number(contribution.toFixed(4))});}
  const baseScore100=positive+negative?100*(total+negative)/(positive+negative):null;
  const habitBonusPoints=habitWeight?Math.min(config.habitBonusCapPoints??3,3*habitTotal/2):0;
  return {baseScore100:baseScore100===null?null:Number(baseScore100.toFixed(2)),habitBonusPoints:Number(habitBonusPoints.toFixed(3)),status:closure.openCount||closure.unknownCount?'PARTIAL_SUCCESS':'SUCCESS',eligible:true,closure,toolAdvice,readyForDelivery:closure.readyForDelivery,component:config.component??options.component??'unknown',total:Number((total+habitTotal).toFixed(3)),closurePenaltyPoints:Number(closure.penaltyPoints.toFixed(3)),score100:baseScore100===null?null:Number(Math.max(0,Math.min(100,baseScore100+habitBonusPoints-closure.penaltyPoints)).toFixed(2)),evidenceCoverage:configuredWeight?Number((availableWeight/configuredWeight).toFixed(4)):0,comparisonScope:hasEvidence?'partial-CATIA-evidence':'offline-plan-only',missingMetrics,breakdown,rejects,rules,notes,screeningOnly:true,
    facts:{steps:steps.length,kinds,solids:(kinds.closed_loft??0)+(kinds.capped_extrude??0),referenceCount:refs.length,generatedTopologyCount:risky.length,fragileDependencyDepth:Math.max(0,...memo.values()),fillCount,extractCount,duplicateShapeCount:duplicates,unassessedToolTasks:taskScores.filter(v=>v===null).length,liveInputsProvided:hasEvidence}};
}
