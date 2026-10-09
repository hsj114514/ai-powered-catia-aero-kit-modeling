// SPDX-License-Identifier: GPL-3.0-only
import { vector } from './validation.js';
import { createHash } from 'node:crypto';
import { vbsNum as N, vbsStr as S } from './vbs.js';
export function axisSystemInput(p) {
  if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['origin','xDirection','yDirection'].includes(k))) throw new Error('axis_system accepts origin, xDirection and yDirection');
  const origin=vector(p.origin??[0,0,0],3,'axis origin');
  const unit=(v,label)=>{v=vector(v,3,label);const n=Math.hypot(...v);if(n<1e-9)throw new Error('zero axis direction');return v.map(x=>x/n);};
  const x=unit(p.xDirection??[1,0,0],'X direction'),y=unit(p.yDirection??[0,1,0],'Y direction');
  if(Math.abs(x.reduce((s,v,i)=>s+v*y[i],0))>1e-7) throw new Error('axis X and Y directions must be orthogonal');
  const z=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
  return {origin,x,y,z};
}
export function axisSystemElement(e) {
  const p=axisSystemInput(e.params),proc='BuildAxis_'+createHash('sha1').update(e.id).digest('hex');
  const lines=['Sub '+proc+'()','  Dim feat, origin(2), vx(2), vy(2), vz(2)','  On Error Resume Next','  If gFatal <> "" Then Exit Sub'];
  for(const [name,values] of [['origin',p.origin],['vx',p.x],['vy',p.y],['vz',p.z]]) values.forEach((v,i)=>lines.push('  '+name+'('+i+') = '+N(v)));
  const checked=(line,tag)=>lines.push('  '+line,'  Chk '+S(e.id+' / '+tag),'  If gFatal <> "" Then Exit Sub');
  checked('Set feat = gPart.AxisSystems.Add()','AxisSystems.Add');
  lines.push('  gTrash.Add gTrash.Count, feat');
  for(const [line,tag] of [['feat.Type = 0','standard axis'],['feat.OriginType = 1','coordinate origin'],['feat.PutOrigin origin','origin'],['feat.XAxisType = 1','coordinate X'],['feat.YAxisType = 1','coordinate Y'],['feat.ZAxisType = 1','coordinate Z'],['feat.PutXAxis vx','X direction'],['feat.PutYAxis vy','Y direction'],['feat.PutZAxis vz','Z direction'],['gPart.UpdateObject feat','update'],['feat.Name = '+S(e.id),'name']]) checked(line,tag);
  lines.push('  If gFeats.Exists('+S(e.id)+') Then gFeats.Remove '+S(e.id),'  gFeats.Add '+S(e.id)+', feat');
  checked('VerifyFeature '+S(e.id)+', "reference"','verify');
  lines.push('End Sub',proc);return lines.join('\n');
}
