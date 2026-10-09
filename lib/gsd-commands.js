// SPDX-License-Identifier: GPL-3.0-only
/** Human command names mapped to actual whitelisted Automation adapters. */
import { apiCatalog, apiInput } from './gsd-api.js';
const rows = [
  ['Extrude','拉伸曲面','沿方向拉伸曲线','AddNewExtrude'],
  ['Revolve','旋转曲面','绕轴旋转截面','AddNewRevol'],
  ['Sphere','球面','完整或部分球面','AddNewSphere'],
  ['Cylinder','圆柱面','创建圆柱曲面','AddNewCylinder'],
  ['Offset','偏移曲面','沿法向偏移曲面','AddNewOffset'],
  ['Variable Offset','可变偏移曲面','按位置改变偏移量',null],
  ['Rough Offset','粗略偏移','近似偏移曲面',null],
  ['Mid Surface','中间曲面','从适用实体提取中间面',['AddNewMidSurface','AddNewMidSurfaceWithAutoThreshold']],
  ['Sweep','扫掠曲面','沿引导线生成曲面',['AddNewSweepExplicit','AddNewSweepCircle','AddNewSweepConic','AddNewSweepLine']],
  ['Adaptive Sweep','自适应扫掠','沿路径改变截面参数',null],
  ['Fill','填充曲面','根据封闭边界填充曲面','AddNewFill'],
  ['Multi-Sections Surface','多截面曲面','多个截面生成曲面','AddNewLoft'],
  ['Blend','混合曲面','在边界间生成过渡曲面','AddNewBlend'],
  ['Join','接合','连接曲面或曲线','AddNewJoin'],
  ['Healing','修复','修复间隙或连续性','AddNewHealing'],
  ['Curve Smooth','曲线平滑','平滑曲线连接','AddNewCurveSmooth'],
  ['Surface Simplification','曲面简化','简化复杂曲面表示',null],
  ['Untrim','取消修剪','恢复未裁剪的支持几何',null],
  ['Disassemble','分解','分离多域几何的指定域','AddNewDatums'],
  ['Split','分割','切割目标并保留指定侧','AddNewHybridSplit'],
  ['Trim','修剪','相互修剪并保留区域','AddNewHybridTrim'],
  ['Sew Surface','缝合曲面','将曲面缝合到当前实体 Body','AddNewSewSurface'],
  ['Remove Face','移除面','移除指定面并重构实体','AddNewRemoveFace'],
  ['Translate','平移','沿方向移动或复制几何','AddNewTranslate'],
  ['Rotate','旋转','绕轴旋转几何','AddNewRotate'],
  ['Symmetry','对称','关于支持元素对称','AddNewSymmetry'],
  ['Scaling','缩放','等比例缩放几何','AddNewHybridScaling'],
  ['Affinity','仿射变换','非均匀比例变换','AddNewAffinity'],
  ['Axis to Axis','轴系到轴系','在两个轴系间变换','AddNewAxisToAxis'],
];
const normalize=s=>String(s).trim().toLowerCase().replace(/[ _-]+/g,' ');
const available=new Set(apiCatalog().operations.map(o=>o.method));
export function commandCatalog(command) {
  const selected=command===undefined?rows:rows.filter(r=>[r[0],r[1]].some(n=>normalize(n)===normalize(command)));
  if(!selected.length) throw new Error('unknown GSD command');
  return selected.map(([english,chinese,purpose,methods])=>{
    const factories=methods===null?[]:Array.isArray(methods)?methods:[methods];
    const implemented=factories.length>0&&factories.every(f=>available.has(f));
    return {english,chinese,purpose,factories,status:implemented?'IMPLEMENTED_NOT_LIVE_VERIFIED':'NOT_IMPLEMENTED',
      ...(implemented?{signatures:factories.map(factory=>apiCatalog({factory}).operations[0])}:{reason:'No verified public Automation adapter in this package. Do not substitute a different operation or invent COM members.'}),
      ...(english==='Disassemble'?{limitation:'One selected domain per persistent element; domainIndex and expectedDomains are required. Repeat with distinct IDs for other domains. Domain order is topology dependent; equal counts do not prove equal identity.'}:{}),
      ...(english==='Axis to Axis'?{limitation:'Create two axis_system ledger elements (origin, xDirection, yDirection) before transforming; both bases must be orthogonal and right handed.'}:{}),
      ...(english==='Mid Surface'?{limitation:'Automatic creation mode only; release/licence and suitable solid input must be checked natively.'}:{}),
    };
  });
}
export function commandInput(args) {
  const row=commandCatalog(args.command)[0];
  if(row.status==='NOT_IMPLEMENTED') throw new Error(row.english+' NOT_IMPLEMENTED: '+row.reason);
  const factory=args.factory??(row.factories.length===1?row.factories[0]:undefined);
  if(!row.factories.includes(factory)) throw new Error('choose a documented factory for '+row.english+': '+row.factories.join(', '));
  return apiInput({factory,arguments:args.arguments,configure:args.configure,bodySource:args.bodySource,domainIndex:args.domainIndex,expectedDomains:args.expectedDomains});
}
