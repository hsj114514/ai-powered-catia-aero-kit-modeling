// SPDX-License-Identifier: GPL-3.0-only
/** Documented Automation adapters. This module never executes COM. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { vbsStr as S, vbsNum as N } from './vbs.js';
import { finiteNumber, vector } from './validation.js';

const catalog = JSON.parse(readFileSync(new URL('./gsd-catalog.json', import.meta.url), 'utf8'));
const factories = new Map(catalog.factories.map(f => [f.method, f]));
const parameterNames = new Set(Object.values(catalog.classes).flatMap(c => c.valueParameters.map(p => p.name)));
const numericTypes = new Set(['double', 'long', 'short']);
const objectTypes = new Set(['Reference', 'HybridShapeDirection', 'HybridShapeIntegratedLaw', 'Length', 'Angle', 'RealParam', 'Body']);
function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(label + ' must be an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(label + ' has unknown field ' + key);
}
function id(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\\/:*?"<>|\u0000-\u001f]/.test(value)
    || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('invalid source element id');
  return value;
}
function typed(value, slot) {
  const label = slot.name, type = slot.type;
  if (numericTypes.has(type) || type.startsWith('Cat')) {
    const n = finiteNumber(value, label, -1e9, 1e9);
    if (type !== 'double' && !Number.isInteger(n)) throw new Error(label + ' must be an integer');
    if (type === 'short' && (n < -32768 || n > 32767)) throw new Error(label + ' exceeds signed short range');
    if (catalog.enums[type] && !catalog.enums[type].includes(n)) throw new Error(label + ' is outside documented enum values');
    if (/^(?:iContinuity[12]?|Continuity|FirstContinuity|SecondContinuity)$/.test(label) && ![0,1,2].includes(n)) throw new Error(label + ' must be G0/G1/G2 (0/1/2)');
    if (label === 'iBlendLimit' && ![1,2].includes(n)) throw new Error('Blend side must be 1 or 2');
    if (/^(?:iOrient[12]?|iOrientation[12]?|iRemoveOrientation)$/.test(label) && ![-1,1].includes(n)) throw new Error(label + ' must be -1 or 1');
    if (/(?:Radius|Tension)/i.test(label) && n < 0) throw new Error(label + ' must not be negative');
    return n;
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(label + ' must be boolean');
    return value;
  }
  if (type === 'CATBSTR') {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u001f]/.test(value)) throw new Error(label + ' must be a bounded string');
    return value;
  }
  if (type === 'CATSafeArrayVariant') {
    if (!Array.isArray(value) || !value.length || value.length > 256) throw new Error(label + ' needs 1..256 references');
    return value.map(v => typed(v, { name: label, type: 'Reference' }));
  }
  if (!objectTypes.has(type)) throw new Error('unsupported documented argument type ' + type);
  if (value === null) return null; // Explicit Nothing; validity is decided by the specific CATIA API.
  if (type === 'HybridShapeDirection' && Object.hasOwn(value ?? {}, 'direction')) {
    object(value, label, ['direction']);
    const v = vector(value.direction, 3, label);
    const length = Math.hypot(...v);
    if (length < 1e-9) throw new Error(label + ' direction must not be zero');
    return { direction: v.map(x => x / length) };
  }
  if (type === 'Reference' && Object.hasOwn(value ?? {}, 'empty')) {
    object(value, label, ['empty']);
    if (value.empty !== true) throw new Error(label + ' empty must be true');
    return { empty: true };
  }
  if (['Length', 'Angle', 'RealParam'].includes(type)) {
    object(value, label, ['ref', 'parameter']);
    if (!parameterNames.has(value.parameter)) throw new Error('parameter object is not documented');
    return { ref: id(value.ref), parameter: value.parameter };
  }
  object(value, label, type === 'Reference' ? ['ref', 'brep'] : ['ref']);
  const out = { ref: id(value.ref) };
  if (value.brep !== undefined) {
    if (typeof value.brep !== 'string' || !value.brep.length || value.brep.length > 8192 || /[\u0000-\u001f]/.test(value.brep)) throw new Error('brep must be a bounded CATIA topology name');
    out.brep = value.brep;
  }
  return out;
}
function tuple(values, slots, label) {
  if (!Array.isArray(values) || values.length !== slots.length) throw new Error(label + ' requires exactly ' + slots.length + ' ordered arguments');
  return values.map((v, i) => typed(v, slots[i]));
}
export function apiInput(args) {
  object(args, 'GSD API parameters', ['factory', 'arguments', 'configure', 'bodySource', 'domainIndex', 'expectedDomains']);
  const f = factories.get(args.factory);
  if (!f) throw new Error('factory is not in the documented whitelist');
  const bodySource = args.bodySource === undefined ? undefined : id(args.bodySource);
  if (f.owner === 'ShapeFactory' && !bodySource) throw new Error('ShapeFactory operations require bodySource to order the base geometry before the fillet');
  if (f.owner !== 'ShapeFactory' && bodySource) throw new Error('bodySource is only valid for ShapeFactory operations');
  const c = catalog.classes[f.result];
  const values = tuple(args.arguments ?? [], f.slots, f.method);
  const actions = args.configure ?? [];
  if (!Array.isArray(actions) || actions.length > 256) throw new Error('configure needs at most 256 actions');
  const configure = actions.map(action => {
    object(action, 'configuration action', ['method', 'arguments', 'property', 'parameter', 'value']);
    if (['method', 'property', 'parameter'].filter(k => Object.hasOwn(action, k)).length !== 1) throw new Error('configuration action needs exactly one member kind');
    if (action.method) {
      if (Object.hasOwn(action, 'value')) throw new Error('method action cannot have value');
      const m = c.calls.find(m => m.name === action.method);
      if (!m) throw new Error('setter method is not documented for ' + f.result + ': ' + action.method);
      return { method: m.name, arguments: tuple(action.arguments, m.slots, m.name) };
    }
    if (Object.hasOwn(action, 'arguments')) throw new Error('property/parameter action cannot have arguments');
    const member = action.property ?? action.parameter;
    const definition = (action.property ? c.properties : c.valueParameters).find(p => p.name === member);
    if (!definition) throw new Error('writable member is not documented for ' + f.result + ': ' + member);
    return { ...(action.property ? { property: member } : { parameter: member }), value: typed(action.value, definition) };
  });
  if (!f.slots.length && !configure.length) throw new Error(f.method + ' needs explicit configuration; an empty constructor is not usable geometry');
  const actionsOf = name => configure.filter(a => a.method === name);
  if (f.method === 'AddNewFill' && !actionsOf('AddBound').length) throw new Error('Fill requires AddBound configuration');
  if (f.method === 'AddNewLoft' && actionsOf('AddSectionToLoft').length < 2) throw new Error('Loft requires at least two sections');
  if (f.method === 'AddNewSpline' && configure.filter(a => /^AddPoint/.test(a.method ?? '')).length < 2) throw new Error('Spline requires at least two points');
  if (f.method === 'AddNewPolyline' && actionsOf('InsertElement').length < 2) throw new Error('Polyline requires at least two inserted points');
  if (f.method === 'AddNewBlend') {
    for (const side of [1, 2]) {
      const last = name => [...actionsOf(name)].reverse().find(a=>a.arguments[0]===side)?.arguments[1];
      if (last('SetCurve') === undefined || last('SetCurve') === null) throw new Error('Blend requires curve on each side');
      if (last('SetContinuity') > 0 && (last('SetSupport') === undefined || last('SetSupport') === null)) throw new Error('G1/G2 Blend requires support on each constrained side');
    }
  }
  if (/^AddNewSweep(?:Circle|Line|Conic)$/.test(f.method) && !configure.length) throw new Error('Sweep mode/laws need explicit configuration');
  if (f.method === 'AddNewPlaneMean' && values[0]?.length !== values[1]) throw new Error('plane mean reference count does not match its array');
  if (f.method==='AddNewAdd'&&!values[0]?.ref) throw new Error('Boolean Add requires a source Body reference');
  let domains = {};
  if (f.method === 'AddNewDatums') {
    if (!Number.isInteger(args.expectedDomains) || args.expectedDomains < 1 || args.expectedDomains > 256) throw new Error('Disassemble needs expectedDomains 1..256');
    if (!Number.isInteger(args.domainIndex) || args.domainIndex < 0 || args.domainIndex >= args.expectedDomains) throw new Error('domainIndex must be inside expectedDomains');
    domains = {domainIndex:args.domainIndex,expectedDomains:args.expectedDomains};
    if (!values[0]?.ref || values[0].brep) throw new Error('Disassemble requires a whole shape-design feature reference');
    if (configure.length) throw new Error('domain datums have no configurable members');
  } else if (args.domainIndex !== undefined || args.expectedDomains !== undefined) throw new Error('domain selection is only valid for AddNewDatums');
  if (f.method.startsWith('AddNewMidSurface') && (!values[0]?.ref || values[0].brep || values[2] <= 0)) throw new Error('Mid Surface requires a whole solid feature and a positive threshold');
  const result = { factory: f.method, arguments: values, configure, ...(bodySource ? {bodySource} : {}), ...domains };
  if (JSON.stringify(result).length > 131072) throw new Error('operation exceeds 128 KiB parameter budget');
  return result;
}
export function apiSources(params) {
  const out = new Set();
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (Object.hasOwn(value, 'ref')) out.add(value.ref);
    for (const v of Object.values(value)) visit(v);
  }
  visit(apiInput(params));
  if (params.bodySource) out.add(params.bodySource);
  return [...out];
}
export function apiExpected(params) {
  const p = apiInput(params), f = factories.get(p.factory);
  if (/^HybridShape(?:Loft|Sweep)/.test(f.result) && [...p.configure].reverse().find(a => a.property === 'Context')?.value === 1) return 'solid';
  return f.kind;
}
export function apiCatalog({ category, factory } = {}) {
  if (category !== undefined && !['wireframe', 'surface', 'operation', 'fillet'].includes(category)) throw new Error('unknown GSD category');
  if (factory !== undefined && !factories.has(factory)) throw new Error('unknown factory');
  return { version: catalog.version, revision: catalog.revision, verification: catalog.verification,
    sources: catalog.sources.slice(), operations: catalog.factories.filter(f => (!category || f.category === category) && (!factory || f.method === factory))
      .map(f => JSON.parse(JSON.stringify({ ...f, configure: catalog.classes[f.result] }))) };
}
export function apiElement(element) {
  const p = apiInput(element.params), f = factories.get(p.factory);
  const proc = 'BuildApi_' + createHash('sha1').update(element.id).digest('hex');
  const declarations = ['feat'], body = []; let seq = 0;
  const checked = (line, tag) => body.push('  ' + line, '  Chk ' + S(element.id + ' / ' + tag), '  If gFatal <> "" Then Exit Sub');
  function literal(value) {
    if (value.length < 400) return S(value);
    const name = 'txt' + (++seq); declarations.push(name);
    body.push('  ' + name + ' = ""');
    for (let i = 0; i < value.length; i += 240) body.push('  ' + name + ' = ' + name + ' & ' + S(value.slice(i,i+240)));
    return name;
  }
  function expression(value, slot) {
    if (value === null) return 'Nothing';
    if (typeof value === 'boolean') return value ? 'True' : 'False';
    if (typeof value === 'string') return literal(value);
    if (typeof value === 'number') return slot.type === 'double' ? N(value) : String(value);
    if (Array.isArray(value)) {
      const name = 'refs' + (++seq); declarations.push(name + '(' + (value.length - 1) + ')');
      value.forEach((v,i) => checked('Set ' + name + '(' + i + ') = ' + expression(v, {type:'Reference'}), 'reference array'));
      return name;
    }
    const name = 'arg' + (++seq); declarations.push(name);
    if (value.direction) checked('Set ' + name + ' = gHsf.AddNewDirectionByCoord(' + value.direction.map(N).join(', ') + ')', 'direction');
    else if (value.empty) checked('Set ' + name + ' = gPart.CreateReferenceFromName("")', 'empty reference');
    else {
      body.push('  If Not gFeats.Exists(' + S(value.ref) + ') Then', '    Fail ' + S('missing API source ' + value.ref), '    Exit Sub', '  End If');
      if (value.parameter) checked('Set ' + name + ' = gFeats(' + S(value.ref) + ').' + value.parameter, 'parameter reference');
      else if (value.brep) checked('Set ' + name + ' = gPart.CreateReferenceFromBRepName(' + literal(value.brep) + ', gFeats(' + S(value.ref) + '))', 'topology reference');
      else if (f.method.startsWith('AddNewMidSurface') && slot.name === 'iSupport') {
        const bodyName='supportBody'+(++seq);declarations.push(bodyName);
        checked('Set ' + bodyName + ' = gFeats(' + S(value.ref) + ').Parent', 'Mid Surface support Body');
        body.push('  If TypeName(' + bodyName + ') <> "Body" Then', '    Fail "Mid Surface support must belong to a solid Body"', '    Exit Sub', '  End If');
        checked('Set ' + name + ' = gPart.CreateReferenceFromObject(' + bodyName + ')', 'Body reference');
      }
      else if (slot.type === 'Reference') checked('Set ' + name + ' = gPart.CreateReferenceFromObject(gFeats(' + S(value.ref) + '))', 'feature reference');
      else if (slot.type === 'Body') {
        // v1.2.0 r8: a solid built with newBody:true is renamed "<elementId>__body" by the solid
        // emitter, but in this CATIA build .Parent does not return that Body, so every AddNewAdd
        // step failed with "Boolean source must belong to an independent Body" and reported no
        // volume. Look the Body up by its recorded name first; keep .Parent only as a fallback.
        // Plain statements: a checked() guard inside For/Next would split the block.
        const scan = 'scanBody' + (++seq); declarations.push(scan);
        body.push(
          '  Set ' + name + ' = Nothing',
          '  For Each ' + scan + ' In gPart.Bodies',
          '    If ' + scan + '.Name = ' + S(value.ref + '__body') + ' Then Set ' + name + ' = ' + scan,
          '  Next',
          '  If ' + name + ' Is Nothing Then Set ' + name + ' = gFeats(' + S(value.ref) + ').Parent',
          '  If TypeName(' + name + ') <> "Body" Then',
          '    Fail "Boolean source must belong to an independent Body"',
          '    Exit Sub',
          '  End If');
      }
      else checked('Set ' + name + ' = gFeats(' + S(value.ref) + ')', 'feature object');
    }
    return name;
  }
  const args = p.arguments.map((v, i) => expression(v, f.slots[i]));
  if (f.owner === 'ShapeFactory') {
    body.push('  If Not gFeats.Exists(' + S(p.bodySource) + ') Then', '    Fail "missing operation base"', '    Exit Sub', '  End If');
    checked('gPart.InWorkObject = gFeats(' + S(p.bodySource) + ')', 'activate operation base');
  }
  else if (f.method === 'AddNewDatums') {
    checked('Set gHb = gFeats(' + S(p.arguments[0].ref) + ').Parent', 'source container');
    body.push('  If TypeName(gHb) <> "HybridBody" Then', '    Fail "Disassemble currently requires a source in a HybridBody"', '    Exit Sub', '  End If');
    checked('gPart.InWorkObject = gHb', 'activate source container');
  } else checked('BeginOpenSet "Aero_GSD"', 'open GSD set');
  if (f.method === 'AddNewDatums') {
    declarations.push('domains', 'domainCount');
    checked('domains = gHsf.AddNewDatums(' + args[0] + ')', f.method);
    body.push('  If Not IsArray(domains) Then', '    Fail "Disassemble returned no domain array"', '    Exit Sub', '  End If');
    checked('domainCount = UBound(domains) - LBound(domains) + 1', 'domain count');
    body.push('  If domainCount <> ' + p.expectedDomains + ' Then', '    Fail "Disassemble domain count changed; review domain identity before rebuilding"', '    Exit Sub', '  End If');
    checked('Set feat = domains(LBound(domains) + ' + p.domainIndex + ')', 'selected domain');
  } else {
    if (f.method === 'AddNewAdd') {
      declarations.push('targetBody');
        declarations.push('scanTargetBody');
        // v1.2.0 r9: the target solid also lives in a Body the solid emitter renamed
        // "<elementId>__body", and .Parent does not return that Body on this build, so the same
        // by-name resolution is required here. Plain statements keep the For/Next block intact.
        body.push(
          '  Set targetBody = Nothing',
          '  If gFeats.Exists(' + S(p.bodySource + '__body') + ') Then Set targetBody = gFeats(' + S(p.bodySource + '__body') + ')',
          '  If targetBody Is Nothing Then',
          '  For Each scanTargetBody In gPart.Bodies',
          '    If scanTargetBody.Name = ' + S(p.bodySource + '__body') + ' Then Set targetBody = scanTargetBody',
          '  Next',
          '  End If',
          '  If targetBody Is Nothing Then Set targetBody = gFeats(' + S(p.bodySource) + ').Parent');      body.push('  If TypeName(targetBody) <> "Body" Then', '    Fail "Boolean target must belong to a Body"', '    Exit Sub', '  End If', '  If targetBody Is ' + args[0] + ' Then', '    Fail "cannot Boolean-add a Body to itself"', '    Exit Sub', '  End If');
      checked('gPart.InWorkObject = targetBody', 'activate resolved Boolean target Body');
    }
    body.push('  Emit '+S('attempted_'+element.id)+', '+S(f.method));
    checked('Set feat = ' + (f.owner === 'ShapeFactory' ? 'gPart.ShapeFactory' : 'gHsf') + '.' + f.method + '(' + args.join(', ') + ')', f.method);
  }
  body.push('  If feat Is Nothing Then', '    Fail ' + S(f.method + ' returned no feature'), '    Exit Sub', '  End If');
  if (f.owner !== 'ShapeFactory') checked('gHb.AppendHybridShape feat', 'append result');
  body.push('  gTrash.Add gTrash.Count, feat');
  if (f.method === 'AddNewAdd') body.push('  If Not gFeats.Exists(' + S(element.id + '__body') + ') Then gFeats.Add ' + S(element.id + '__body') + ', targetBody');
  const c = catalog.classes[f.result];
  for (const action of p.configure) {
    if (action.method) {
      const m = c.calls.find(m => m.name === action.method);
      const values = action.arguments.map((v, i) => expression(v, m.slots[i]));
      checked('feat.' + action.method + (values.length ? ' ' + values.join(', ') : ''), action.method);
    } else if (action.parameter) checked('feat.' + action.parameter + '.Value = ' + N(action.value), action.parameter + '.Value');
    else {
      const definition = c.properties.find(p => p.name === action.property);
      const value = expression(action.value, definition);
      checked((objectTypes.has(definition.type) ? 'Set ' : '') + 'feat.' + action.property + ' = ' + value, action.property);
    }
  }
  checked('gPart.UpdateObject feat', 'update result');
  checked('RenameShape feat, ' + S(element.id), 'name result');
  body.push('  If gFeats.Exists(' + S(element.id) + ') Then gFeats.Remove ' + S(element.id), '  gFeats.Add ' + S(element.id) + ', feat');
  checked('VerifyFeature ' + S(element.id) + ', ' + S(apiExpected(p)), 'verify geometry');
  const dims = [];
  for (let i = 0; i < declarations.length; i += 20) dims.push('  Dim ' + declarations.slice(i,i+20).join(', '));
  return ['Sub ' + proc + '()', ...dims, '  On Error Resume Next', '  If gFatal <> "" Then Exit Sub', ...body, 'End Sub', proc].join('\n');
}
