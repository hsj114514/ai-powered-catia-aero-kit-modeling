// SPDX-License-Identifier: GPL-3.0-only
/** Conditional positive priors. Names, prose and tool-unavailability claims are not evidence. */
import { elementGeometry, orderedElements } from './ops.js';
import { apiSources, apiCatalog } from './gsd-api.js';
import { gsdSources } from './solid-ops.js';
import { dependencies, planningHabits } from './planning-policy.js';
const DATUM = new Set(['XY','YZ','ZX']);
const referenceKinds = new Set(['axis_system','plane','point','line','guide_curve','section','sketch']);
const factories = new Map(apiCatalog().operations.map(f => [f.method,f]));
const finite = x => typeof x === 'number' && Number.isFinite(x);

export function planarAxis(points) {
  if (!Array.isArray(points) || points.length < 3 || points.some(p => !Array.isArray(p) || ![2,3].includes(p.length) || p.some(x => !finite(x)))) return null;
  if (points.every(p => p.length === 2)) return 'XY';
  if (points.some(p => p.length !== 3)) return null;
  for (let i=0;i<3;i++) if (points.every(p => Math.abs(p[i]-points[0][i]) <= 1e-6)) return ['YZ','ZX','XY'][i];
  return null;
}
export function is2DProfile(s) {
  const p=s?.params??{};
  if (s?.kind==='sketch') { const plane=String(p.plane??p.base??'XY').toUpperCase(); return DATUM.has(plane)?plane:null; }
  if (s?.kind==='section') return 'XY';
  if (s?.kind==='guide_curve') return planarAxis(p.points);
  if (s?.kind==='endplate') return 'XY';
  return null; // a datum plane or a whole loft is not a profile
}
function refs(s) {
  if(s.kind==='gsd_api') return apiSources(s.params);
  if(s.kind==='gsd') return gsdSources(s.params);
  if(s.kind==='capped_extrude') return [s.params.from];
  if(s.kind==='flap') return [s.params.parentId];
  return [];
}
function mirrored(a,b,map) {
  try {
    if(a.kind!==b.kind||Boolean(a.params.closed)!==Boolean(b.params.closed)) return false;
    const ga=elementGeometry(a,map),gb=elementGeometry(b,map);
    if(!ga || !gb) return false;
    const key=(g,sign)=>g.contours.flat().map(p=>[p[0],p[1],sign*p[2]].map(n=>Math.round(n*1e5)).join(',')).sort();
    return JSON.stringify(key(ga,-1))===JSON.stringify(key(gb,1));
  } catch { return false; }
}
export function evaluateHabitPriors(plan,options={}) {
  const steps=Array.isArray(plan?.steps)?plan.steps:[],map=Object.fromEntries(steps.map(s=>[s.id,s]));
  const used=new Set(steps.flatMap(dependencies));
  const declaredOutputs=new Set((plan.geometryRequirements??[]).map(r=>r.target));
  const profiles=steps.filter(s=>['sketch','endplate'].includes(s.kind)&&is2DProfile(s)&&(s.kind==='endplate'||used.has(s.id)||steps.length===1||declaredOutputs.has(s.id))); // polygon-only Sketcher cannot replace a curved airfoil/spline faithfully
  const unavailable=options.sketcherAvailable===false;
  const declared=s=>unavailable && s.substitute?.preferred==='sketcher' && typeof s.substitute?.reason==='string' && s.substitute.reason.trim().length>0;
  const rate=(items,f)=>items.length?items.reduce((sum,s)=>sum+f(s),0)/items.length:null;
  const out={habitSketchOnDatum2D:rate(profiles,s=>!unavailable&&s.kind==='sketch'?1:declared(s) ? .5 : 0)};
  const planes=steps.filter(s=>s.kind==='plane');
  out.habitNamedDatumPlane=rate(planes,s=>DATUM.has(String(s.params?.base??'XY').toUpperCase())&&(s.params.offset??0)===0?1:0);
  const pairs=steps.filter(s=>/(^|_)R(_|$)/.test(s.id)).map(s=>[s,map[s.id.replace(/(^|_)R(_|$)/,'$1L$2')]]).filter(p=>p[1]);
  const mirrors=steps.filter(s=>s.kind==='gsd_api'&&s.params.factory==='AddNewSymmetry');
  const mirrorOK=s=>{const ref=s.params.arguments?.[1]?.ref,p=map[ref];return p?.kind==='plane'&&String(p.params.base??'XY').toUpperCase()==='XY'&&(p.params.offset??0)===0;};
  out.habitSymmetryAboutCentreline=pairs.length||mirrors.length?(pairs.filter(([a,b])=>mirrored(a,b,map)).length+mirrors.filter(mirrorOK).length)/(pairs.length+mirrors.length):null;
  // The builder sorts the DAG. Reward actual datum dependencies; input array order has no meaning.
  try {
    orderedElements(map);
    const uses=steps.filter(s=>!referenceKinds.has(s.kind)&&factories.get(s.params.factory)?.kind!=='reference').flatMap(refs).filter(id=>referenceKinds.has(map[id]?.kind)||factories.get(map[id]?.params?.factory)?.kind==='reference');
    out.habitDatumFirstOrdering=uses.length?1:null;
  } catch { out.habitDatumFirstOrdering=null; }
  out.habitDeclaredSubstitute=unavailable?rate(profiles,s=>declared(s)?1:0):null;
  // H6 needs a part scope and measured bodies, not merely a count of solid-building requests.
  const evidence=options.evidence,live=evidence?.source==='CATIA'&&typeof evidence.runId==='string'&&!!evidence.runId.trim();
  const solids=steps.filter(s=>['closed_loft','capped_extrude'].includes(s.kind)||s.kind==='gsd'&&s.params.op?.startsWith('solid_')||s.kind==='gsd_api'&&factories.get(s.params.factory)?.kind==='solid');
  const grouped=new Map();
  for(const s of solids) if(typeof s.part==='string'&&s.part.trim()) grouped.set(s.part,[...(grouped.get(s.part)??[]),s]);
  out.habitSingleClosedBody=live&&solids.length&&grouped.size&&solids.every(s=>s.part&&typeof evidence.bodies?.[s.id]?.bodyId==='string'&&!!evidence.bodies[s.id].bodyId.trim()&&finite(evidence.bodies[s.id].volumeMm3)&&evidence.bodies[s.id].volumeMm3>0)
    ?rate([...grouped.values()],g=>new Set(g.map(s=>evidence.bodies[s.id].bodyId)).size===1?1:0):null;
  return {...out,...planningHabits(steps)};
}
export const HABIT_KEYS=['habitSketchOnDatum2D','habitNamedDatumPlane','habitSymmetryAboutCentreline','habitDatumFirstOrdering','habitDeclaredSubstitute','habitSingleClosedBody','habitMeaningfulConstraints','habitTaskMatchedTools'];
export const HABIT_DESCRIPTIONS={
  habitMeaningfulConstraints:'H7 被实际建模依赖消费的草图具有合法、兼容输入的边长约束；不按数量奖励，不代表完全约束。',
  habitTaskMatchedTools:'H8 按实际相连步骤的任务分组评价工具适用性，重复工具和无关节点不增加奖励。',
  habitSketchOnDatum2D:'H1 每个适用二维轮廓单独评估；草图为 1，已证实不可用且结构化声明替代为 0.5。',
  habitNamedDatumPlane:'H2 已命名默认面且偏移为零。',
  habitSymmetryAboutCentreline:'H3 比较镜像坐标或引用零偏移 XY 面的原生 Symmetry；名称不能证明对称。',
  habitDatumFirstOrdering:'H4 实际基准依赖由 DAG 排序后先行，输入数组顺序无奖励。',
  habitDeclaredSubstitute:'H5 仅在调用方明确提供首选工具不可用状态时评估逐轮廓替代声明。',
  habitSingleClosedBody:'H6 按 part 分组，要求带 runId、最终 Body 身份的 CATIA 正体积证据；离线不推断闭合。',
};
