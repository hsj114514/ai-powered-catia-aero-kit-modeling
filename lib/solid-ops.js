// SPDX-License-Identifier: GPL-3.0-only
/** Validated ledger features for GSD surfaces and surface-based Part Design solids. */
import { createHash } from 'node:crypto';
import { finiteNumber, optionalNumber } from './validation.js';
import { vbsStr as S, vbsNum as N } from './vbs.js';

export const GSD_OPS = {
  join: { level: 1, label: 'join connected surface sheets' },
  fill: { level: 1, label: 'fill a closed boundary' },
  loft: { level: 1, label: 'loft ordered section curves' },
  offset: { level: 1, label: 'signed surface offset' },
  extrude: { level: 1, label: 'principal-axis curve extrusion' },
  solid_thick: { level: 1, label: 'thicken a surface' },
  solid_close: { level: 1, label: 'close a watertight shell' },
};
const axes = { X:[1,0,0], '-X':[-1,0,0], Y:[0,1,0], '-Y':[0,-1,0], Z:[0,0,1], '-Z':[0,0,-1] };

function elementId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error(label + ' must be a nonempty element id');
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(value) || ['__proto__','constructor','prototype'].includes(value)) throw new Error(label + ' must not contain unsafe characters');
  return value;
}
function idList(value, label, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(label + ' must list ' + min + '..' + max + ' element ids');
  const ids = value.map((v,i)=>elementId(v,label+'['+i+']'));
  if (new Set(ids).size !== ids.length) throw new Error(label + ' must not repeat an element');
  return ids;
}
export function gsdInput(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('GSD arguments must be an object');
  const op = args.op;
  if (typeof op !== 'string' || !Object.hasOwn(GSD_OPS,op)) throw new Error('op must be one of: ' + Object.keys(GSD_OPS).join(', '));
  if (op === 'join') return {op,from:idList(args.from,'from',2,40),connexion:optionalNumber(args.connexion,'connexion',0.001,0.000001,1)};
  if (op === 'fill' || op === 'loft') return {op,from:idList(args.from,'from',op==='fill'?1:2,40)};
  const from = idList(args.from,'from',1,1)[0];
  if (op === 'offset') {
    if (args.bothSides !== undefined && typeof args.bothSides !== 'boolean') throw new Error('bothSides must be a boolean');
    if (args.bothSides === true) throw new Error('bothSides is not a single offset surface; create two signed offsets explicitly');
    return {op,from,distance:finiteNumber(args.distance,'distance',-5000,5000)};
  }
  if (op === 'extrude') {
    if (typeof args.dir !== 'string' || !Object.hasOwn(axes,args.dir)) throw new Error('dir must be one of: ' + Object.keys(axes).join(', '));
    return {op,from,dir:args.dir,limit1:finiteNumber(args.limit1,'limit1',0.001,100000),limit2:optionalNumber(args.limit2,'limit2',0,0,100000)};
  }
  if (op === 'solid_thick') return {op,from,offset1:optionalNumber(args.offset1,'offset1',2,0.01,500),offset2:optionalNumber(args.offset2,'offset2',0,0,500)};
  return {op,from};
}
export function gsdSources(params) {
  return Array.isArray(params.from) ? params.from : [params.from];
}

/** Every factory/property/update step can stop the procedure; only verified results are registered. */
export function gsdElement(element, scope = '', {newBody = false} = {}) {
  const p = gsdInput({...element.params,from:gsdSources(element.params)});
  const ids = gsdSources(p);
  const proc = 'BuildGsd_' + createHash('sha1').update(scope + '\0' + String(element.id)).digest('hex');
  const isSolid = p.op.startsWith('solid_');
  if(newBody && !isSolid) throw new Error('newBody is only valid for a solid factory');
  const lines = ['Sub '+proc+'()', '  Dim feat, refs(39), direction, i, body', '  On Error Resume Next', '  If gFatal <> "" Then Exit Sub'];
  const checked = (statements,tag) => { lines.push(...statements.map(s=>'  '+s),'  Chk '+S(tag),'  If gFatal <> "" Then Exit Sub'); };
  if (!isSolid) checked(['BeginOpenSet "Aero_Solids"'],'open GSD set');
  ids.forEach((id,i) => {
    lines.push('  If Not gFeats.Exists('+S(id)+') Then','    Fail '+S('gsd feature references missing element '+id),'    Exit Sub','  End If');
    checked(['Set refs('+i+') = gPart.CreateReferenceFromObject(gFeats('+S(id)+'))'],'reference '+id);
  });
  if (isSolid && newBody) {
    checked(['Set body = gPart.Bodies.Add()'],'create independent solid body');
    lines.push('  gTrash.Add gTrash.Count, body');
    checked(['RenameShape body, '+S(element.id+'__body')],'name solid body');
    checked(['gPart.InWorkObject = body'],'activate independent solid body');
  } else if (isSolid) checked(['gPart.InWorkObject = gPart.MainBody'],'activate PartBody');
  lines.push('  Emit '+S('attempted_'+element.id)+', '+S(p.op));
  if (p.op==='join') {
    checked(['Set feat = gHsf.AddNewJoin(refs(0), refs(1))'],'AddNewJoin');
  } else if (p.op==='fill') {
    checked(['Set feat = gHsf.AddNewFill()'],'AddNewFill');
  } else if (p.op==='loft') {
    checked(['Set feat = gHsf.AddNewLoft()'],'AddNewLoft');
  } else if (p.op==='offset') {
    checked(['Set feat = gHsf.AddNewOffset(refs(0), '+N(Math.abs(p.distance))+', '+(p.distance<0?'True':'False')+', 0.001)'],'AddNewOffset');
  } else if (p.op==='extrude') {
    checked(['Set direction = gHsf.AddNewDirectionByCoord('+axes[p.dir].map(N).join(', ')+')'],'AddNewDirectionByCoord');
    checked(['Set feat = gHsf.AddNewExtrude(refs(0), '+N(p.limit1)+', '+N(p.limit2)+', direction)'],'AddNewExtrude');
  } else if (p.op==='solid_thick') {
    checked(['Set feat = gPart.ShapeFactory.AddNewThickSurface(refs(0), 1, '+N(p.offset1)+', '+N(p.offset2)+')'],'ShapeFactory.AddNewThickSurface');
  } else {
    checked(['Set feat = gPart.ShapeFactory.AddNewCloseSurface(refs(0))'],'ShapeFactory.AddNewCloseSurface');
  }
  lines.push('  If feat Is Nothing Then','    Fail '+S(p.op+' returned no feature'),'    Exit Sub','  End If');
  // Solid factory results are already in the body; GSD results are appended before tracking.
  if (!isSolid) checked(['gHb.AppendHybridShape feat'],'AppendHybridShape('+p.op+')');
  lines.push('  gTrash.Add gTrash.Count, feat');
  if (p.op==='join') {
    ids.slice(2).forEach((_,i)=>checked(['feat.AddElement refs('+(i+2)+')'],'Join.AddElement'));
    checked(['feat.SetDeviation '+N(p.connexion)],'Join tolerance');
    checked(['feat.SetConnex True'],'Join connexity');
  } else if (p.op==='fill') {
    ids.forEach((_,i)=>checked(['feat.AddBound refs('+i+')'],'Fill.AddBound'));
    checked(['feat.Continuity = 0'],'Fill point continuity');
  } else if (p.op==='loft') {
    ids.forEach((_,i)=>checked(['feat.AddSectionToLoft refs('+i+'), 1, Nothing'],'Loft.AddSectionToLoft'));
    checked(['feat.SectionCoupling = 1'],'Loft coupling');
  }
  checked(['gPart.UpdateObject feat'],'update '+element.id);
  checked(['RenameShape feat, '+S(element.id)],'name '+element.id);
  lines.push('  If gFeats.Exists('+S(element.id)+') Then gFeats.Remove '+S(element.id),'  gFeats.Add '+S(element.id)+', feat');
  const quality = isSolid ? 'solid' : 'surface';
  checked(['VerifyFeature '+S(element.id)+', '+S(quality)],'verify '+element.id);
  lines.push('End Sub',proc);
  return lines.join('\n');
}

/** Parameter reflection. Unsupported transformations are rejected. */
export function mirrorParams(kind,p) {
  const negZ = points => points.map(v=>[v[0],v[1],-v[2]]);
  if(kind==='point') return {...p,z:-p.z};
  if(kind==='line') return {...p,z1:-p.z1,z2:-p.z2};
  if(kind==='guide_curve') return {...p,points:negZ(p.points)};
  if(kind==='surface') return {...p,sections:p.sections.map(negZ)};
  if(kind==='closed_loft') return {...p,sections:p.sections.map(negZ)};
  if(kind==='plane' && String(p.base).toUpperCase()==='XY') return {...p,offset:-p.offset};
  if(kind==='endplate') return {...p,z:-Number(p.z??0)-Number(p.thickness??2)};
  if(kind==='wing') {
    if(Number(p.sweepDeg??0)!==0) throw new Error('mirroring a swept wing is not implemented');
    if(Number(p.twist??0)!==0) throw new Error('mirroring a twisted wing is not implemented');
    const span=Number(p.span), angle=Number(p.dihedralDeg??0)*Math.PI/180;
    return {...p,zStart:-(Number(p.zStart??0)+span),chordRoot:p.chordTip??p.chordRoot,chordTip:p.chordRoot,dihedralDeg:-Number(p.dihedralDeg??0),yOffset:Number(p.yOffset??0)+span*Math.tan(angle)};
  }
  throw new Error('mirroring kind "'+kind+'" is not implemented');
}

/** Valid minimal specimens; each trial updates and measures geometry before reporting capability. */
export function probeBody() {
  const boundary={id:'probe_face',kind:'gsd',params:{op:'fill',from:['probe_wire']}};
  const bodies = [
    ['fill',boundary],
    ['extrude',{id:'probe_extrude',kind:'gsd',params:{op:'extrude',from:'probe_edge',dir:'Z',limit1:10,limit2:0}}],
    ['offset',{id:'probe_offset',kind:'gsd',params:{op:'offset',from:'probe_face',distance:2}}],
    ['loft',{id:'probe_loft',kind:'gsd',params:{op:'loft',from:['probe_edge','probe_edge2']}}],
    ['join',{id:'probe_join',kind:'gsd',params:{op:'join',from:['probe_face','probe_extrude'],connexion:0.001}}],
    ['solid_thick',{id:'probe_thick',kind:'gsd',params:{op:'solid_thick',from:'probe_face',offset1:1,offset2:0}}],
    ['solid_close',{id:'probe_closed',kind:'gsd',params:{op:'solid_close',from:'probe_shell'}}],
  ];
  const lines=['AttachCatia','Dim probeFailure, probeTrials','probeTrials = 0','If gFatal = "" Then'];
  for(const [name,element] of bodies) {
    const render = e=>gsdElement(e,name);
    const body = render(element);
    lines.push('  gFatal = ""','  NewDocument','  BeginOpenSet "Probe_Inputs"','  BeginSection "probe_wire"','  AddSectionPt "probe_wire", 0, 0, 0','  AddSectionPt "probe_wire", 20, 0, 0','  AddSectionPt "probe_wire", 20, 20, 0','  AddSectionPt "probe_wire", 0, 20, 0','  MakePolygon "probe_wire", "probe_wire"','  MakeLine "probe_edge", 0, 0, 0, 20, 0, 0','  MakeLine "probe_edge2", 0, 0, 10, 20, 0, 10','  UpdateNow "probe inputs"');
    if(['offset','join','solid_thick','solid_close'].includes(name))lines.push(render(boundary));
    if(name==='join'||name==='solid_close') lines.push(render({id:'probe_extrude',kind:'gsd',params:{op:'extrude',from:'probe_wire',dir:'Z',limit1:10,limit2:0}}));
    if(name==='solid_close') {
      lines.push('BeginSection "probe_back_wire"','AddSectionPt "probe_back_wire", 0, 0, 10','AddSectionPt "probe_back_wire", 20, 0, 10','AddSectionPt "probe_back_wire", 20, 20, 10','AddSectionPt "probe_back_wire", 0, 20, 10','MakePolygon "probe_back_wire", "probe_back_wire"');
      lines.push(render({id:'probe_back',kind:'gsd',params:{op:'fill',from:['probe_back_wire']}}),render({id:'probe_shell',kind:'gsd',params:{op:'join',from:['probe_face','probe_back','probe_extrude'],connexion:0.001}}));
    }
    lines.push(body,'  If gFatal = "" Then','    Emit '+S('api_'+name)+', "verified"','  Else','    Emit '+S('api_'+name)+', "failed|" & gFatal','  End If','  probeTrials = probeTrials + 1','  Err.Clear','  If Not gDoc Is Nothing Then','    gDoc.Close','    If Err.Number <> 0 Then','      Emit "probeCleanupError", '+S(name)+' & "|" & Err.Description','    Else','      Emit '+S('probeClosed_'+name)+', "true"','    End If','  End If','  Err.Clear','  Set gDoc = Nothing','  Set gTrash = CreateObject("Scripting.Dictionary")','  Set gFeats = CreateObject("Scripting.Dictionary")','  Set gSecs = CreateObject("Scripting.Dictionary")','  Set gSectPts = CreateObject("Scripting.Dictionary")');
  }
  lines.push('  gFatal = ""','  Emit "probeCount", CStr(probeTrials)','  Emit "documentSaved", "false"','  Emit "interpretation", "verified = valid specimen updated and measured; failed = arguments, licence, interface or geometry failed. Error 438 alone cannot distinguish all causes."','End If');
  return lines.join('\n');
}
