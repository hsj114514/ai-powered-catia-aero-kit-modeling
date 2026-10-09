// SPDX-License-Identifier: GPL-3.0-only
/** Shared source-type contracts for the builder and offline evaluator. */
import { expectedGeometry, elementGeometry } from './ops.js';
import { cappedExtrudeInput, planarPolygon } from './closed-solid.js';
import { gsdSources } from './solid-ops.js';
export function validateOperationSources(e, elements) {
  const p=e.params;
  if(e.kind==='capped_extrude') {
    const input=cappedExtrudeInput(p),source=elements[input.from];
    if(!source||!['curve','auto'].includes(expectedGeometry(source))) throw new Error('capped_extrude requires a closed planar curve source; native Fill checks closure');
    if(source.kind==='sketch'&&source.params.closed===false) throw new Error('capped_extrude requires a closed sketch');
    if(source.kind==='guide_curve'&&source.params.closed!==true) throw new Error('capped_extrude source guide_curve must be closed');
    const geometry=elementGeometry(source,elements);
    if(geometry?.contours.length===1) {
      const cap=planarPolygon(geometry.contours[0],'extrusion cap input');
      if(Math.abs(cap.normal.reduce((sum,n,i)=>sum+n*input.direction[i],0))<1e-6) throw new Error('extrusion direction is parallel to the cap plane');
    }
  }
  if(e.kind==='gsd_api') {
    const sources=p.arguments?.map(ref=>elements[ref?.ref]);
    if(p.factory==='AddNewAxisToAxis'&&sources.slice(1).some(s=>s?.kind!=='axis_system')) throw new Error('Axis to Axis requires two explicit axis_system elements');
    if(p.factory.startsWith('AddNewMidSurface')&&(!sources[0]||expectedGeometry(sources[0])!=='solid')) throw new Error('Mid Surface requires a solid source');
    if(p.factory==='AddNewAdd') {
      const source=sources[0],target=elements[p.bodySource];
      if(!source||!target||source.id===target.id||expectedGeometry(source)!=='solid'||expectedGeometry(target)!=='solid') throw new Error('Boolean Add requires two different solid features');
      if(!['closed_loft','capped_extrude'].includes(source.kind)) throw new Error('Boolean Add source must be an independent closed_loft/capped_extrude Body');
    }
    if(p.bodySource&&!['surface','solid','auto'].includes(expectedGeometry(elements[p.bodySource]))) throw new Error('operation bodySource requires surface or solid geometry');
    if(p.factory==='AddNewHybridSplit') {
      if(!sources[0]||!['curve','surface','auto'].includes(expectedGeometry(sources[0]))) throw new Error('GSD split requires curve or surface geometry to split');
      const cutter=sources[1];
      if(!cutter||!(['curve','surface','auto'].includes(expectedGeometry(cutter))||cutter.kind==='plane'||cutter.params?.factory?.startsWith('AddNewPlane'))) throw new Error('GSD split cutter must be a curve, surface or plane');
    }
  }
  if(e.kind==='gsd') {
    if(p.op==='fill'&&gsdSources(p).length===1) {const source=elements[gsdSources(p)[0]];if(source?.kind==='sketch'&&source.params.closed===false)throw new Error('single Fill boundary requires a closed sketch');}

    const required=['fill','loft','extrude'].includes(p.op)?'curve':'surface';
    const types=gsdSources(p).map(id=>expectedGeometry(elements[id]));
    if(types.some(type=>type!==required&&type!=='auto')) throw new Error(p.op+' requires '+required+' source geometry');
  }
}
