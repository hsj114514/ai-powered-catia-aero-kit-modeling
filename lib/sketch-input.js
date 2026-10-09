// SPDX-License-Identifier: GPL-3.0-only
/** Straight Sketcher profiles; supported constraints must preserve the input geometry. */
import { planarPolygon } from './closed-solid.js';
import { vector, finiteNumber } from './validation.js';
export const SKETCH_AXES = {
  XY: { u: [1,0,0], v: [0,1,0], normal: 2 },
  YZ: { u: [0,1,0], v: [0,0,1], normal: 0 },
  ZX: { u: [0,0,1], v: [1,0,0], normal: 1 },
};
export const CONSTRAINT_TYPES = {length:5,horizontal:10,vertical:13,parallel:8,perpendicular:11};
export function sketchInput(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('sketch params must be an object');
  for (const key of Object.keys(p)) if (!['plane','base','origin','points','closed','constraint','constraints'].includes(key)) throw new Error('unknown sketch parameter '+key);
  const plane=String(p.plane??p.base??'XY').toUpperCase();
  if (!Object.hasOwn(SKETCH_AXES,plane)) throw new Error('sketch plane must be XY, YZ or ZX');
  if (p.plane && p.base && String(p.base).toUpperCase()!==plane) throw new Error('conflicting sketch plane and base');
  if (p.closed!==undefined && typeof p.closed!=='boolean') throw new Error('sketch closed must be a boolean');
  const closed=p.closed!==false, axes=SKETCH_AXES[plane], origin=vector(p.origin??[0,0,0],3,'sketch origin');
  if (!Array.isArray(p.points)||p.points.length<(closed?3:2)||p.points.length>256) throw new Error('sketch points need '+(closed?'3':'2')+'..256 [u,v] pairs');
  const local=p.points.map((pt,i)=>vector(pt,2,'sketch points['+i+']'));
  let world=local.map(([u,v])=>origin.map((n,i)=>n+u*axes.u[i]+v*axes.v[i]));
  if (closed) {
    const polygon=planarPolygon(world,'sketch profile');
    if(polygon.points.length!==local.length)local.pop();
    world=polygon.points;
  } else {
    if(local.slice(1).some((pt,i)=>Math.hypot(pt[0]-local[i][0],pt[1]-local[i][1])<1e-6)) throw new Error('open sketch has duplicate adjacent points');
    if(Math.hypot(local[0][0]-local.at(-1)[0],local[0][1]-local.at(-1)[1])<1e-6) throw new Error('open sketch must not repeat the closing point; use closed:true');
  }
  const edgeCount=local.length-(closed?0:1);
  if(p.constraint!==undefined && p.constraints!==undefined)throw new Error('use constraint or constraints, not both');
  const raw=p.constraints??(p.constraint===undefined?[]:[p.constraint]);
  if(!Array.isArray(raw)||raw.length>Math.min(768,3*edgeCount))throw new Error('too many sketch constraints');
  const used=new Set(), orientations=new Map(), pairs=new Map();
  const edgeVector=i=>local[(i+1)%local.length].map((n,k)=>n-local[i][k]);
  const constraints=raw.map(c=>{
    if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['type','edge','otherEdge','value'].includes(k)))throw new Error('invalid sketch constraint');
    const type=c.type??'length', edge=c.edge??0;
    if(!Object.hasOwn(CONSTRAINT_TYPES,type))throw new Error('unsupported sketch constraint '+type);
    if(!Number.isInteger(edge)||edge<0||edge>=edgeCount)throw new Error('constraint edge must be a zero-based edge index');
    const v=edgeVector(edge), length=Math.hypot(...v), bi=['parallel','perpendicular'].includes(type);
    let otherEdge=c.otherEdge;
    if(bi && (!Number.isInteger(otherEdge)||otherEdge<0||otherEdge>=edgeCount||otherEdge===edge))throw new Error('constraint otherEdge must refer to a different edge');
    if(!bi && otherEdge!==undefined)throw new Error('otherEdge only applies to parallel/perpendicular');
    const key=type+'/'+(bi?[edge,otherEdge].sort((a,b)=>a-b).join('/'):edge);
    if(used.has(key))throw new Error('duplicate sketch constraint');
    used.add(key);
    if(type==='length') {
      const value=finiteNumber(c.value,'constraint.value',1e-6,1e6);
      if(Math.abs(value-length)>1e-6)throw new Error('constraint length differs from profile edge; edit points and length together');
      return {type,edge,value};
    }
    if(c.value!==undefined)throw new Error(type+' is a geometric constraint; no value permitted');
    if(type==='horizontal'||type==='vertical') {
      if(orientations.has(edge)&&orientations.get(edge)!==type)throw new Error('conflicting edge orientation constraints');
      orientations.set(edge,type);
      if(Math.abs(v[type==='horizontal'?1:0])>1e-6)throw new Error(type+' constraint differs from input geometry');
      return {type,edge};
    }
    const pair=[edge,otherEdge].sort((a,b)=>a-b).join('/');
    if(pairs.has(pair)&&pairs.get(pair)!==type)throw new Error('conflicting pair constraints');
    pairs.set(pair,type);
    const w=edgeVector(otherEdge), denom=length*Math.hypot(...w);
    const residual=type==='parallel'?Math.abs(v[0]*w[1]-v[1]*w[0])/denom:Math.abs(v[0]*w[0]+v[1]*w[1])/denom;
    if(residual>1e-8)throw new Error(type+' constraint differs from input geometry');
    return {type,edge,otherEdge};
  });
  return {plane,origin,closed,edgeCount,points:local,world,axisData:[...origin,...axes.u,...axes.v],offset:origin[axes.normal],constraints};
}
