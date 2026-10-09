// SPDX-License-Identifier: GPL-3.0-only
/** Fixed aero topology helpers, validated against the same offline builders as registered tools. */
import {elementFragment,elementContext,orderedElements} from './ops.js';
import {wingStations} from './airfoil.js';
import {safeName} from './bridge.js';
const validate=steps=>{const map=Object.fromEntries(steps.map(s=>[s.id,s]));if(Object.keys(map).length!==steps.length)throw new Error('duplicate element id');for(const s of orderedElements(map))elementFragment(s,elementContext(s,map));return steps;};
const bool=(v,label)=>{if(typeof v!=='boolean')throw new Error(label+' must be boolean');return v;};
export function wingSection({profile='2412',chord,aoa=0,twist=0,position,thickness_scale=1,invert=true,id}) {
  const s={id:safeName(id,'id'),kind:'section',params:{naca:profile,chord,aoaDeg:aoa,twistDeg:twist,origin:position,thicknessScale:thickness_scale,invertProfile:bool(invert,'invert')}};
  validate([s]);return s;
}
export function multiSectionWing({name,rootChord,tipChord=rootChord,span,aoaRoot=0,twist=0,sweepDeg=0,dihedralDeg=0,zStart=null,stations=3,xOffset=0,yOffset=0,profile='2412',invert=true,thickness_scale=1}) {
  safeName(name,'name');
  const params={naca:profile,chordRoot:rootChord,chordTip:tipChord,span,zStart:zStart===null?-span/2:zStart,aoaRoot,twist,sweepDeg,dihedralDeg,stations,xOffset,yOffset,thicknessScale:thickness_scale,invertProfile:bool(invert,'invert')};
  const steps=validate([{id:name,kind:'wing',params}]);
  // The wing builder creates these internal sections, not separately bindable ledger elements.
  return {name,profile,steps,ids:wingStations(params).map((s,i)=>name+'__s'+(i+1)),sectionIdsAreInternal:true};
}
export function multiElementWing({name,main,flaps=[]}) {
  safeName(name,'name');
  if(!main||!Array.isArray(main.steps)||!main.steps.some(s=>s.id===main.name&&s.kind==='wing'))throw new Error('main must contain a wing');
  if(!Array.isArray(flaps)||flaps.length>3)throw new Error('flaps must be an array of at most 3 elements');
  const steps=structuredClone(main.steps);let parent=main.name;
  flaps.forEach((f,i)=>{const id=name+'_Flap'+(i+1),base=steps.find(s=>s.id===parent).params;
    steps.push({id,kind:'flap',params:{naca:f.profile??base.naca??'2412',...(f.coordinates?{coordinates:f.coordinates}:{}),parentId:parent,chordRatio:f.chordRatio,deflectionDeg:f.deflectionDeg??0,gap:f.gap??2,overlap:f.overlap??0,gapSide:f.gapSide??'positive',invertProfile:bool(f.invert??base.invertProfile??true,'invert')}});parent=id;
  });validate(steps);return {name,steps,elementCount:1+flaps.length};
}
export function endplate({name,z,chord,height,sweepDeg=0,outlinePoints=null,thickness=2}) {
  const s={id:safeName(name,'name'),kind:'endplate',params:{z,chord,height,sweepDeg,thickness,...(outlinePoints?{outlinePoints}: {})}};validate([s]);return s;
}
/** Legacy helper retained, without publishing unconfirmed numeric regulations. */
export function releaseHeight(){return {height_min:null,ground_clearance_min:null,allowed_elements:[1,2,3,4],verification_status:'UNVERIFIED',note:'No confirmed universal height/clearance limit. Fixed default maximum: main plus 3 serial flaps; use confirmed rules and vehicle datums.'};}
