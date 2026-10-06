// SPDX-License-Identifier: GPL-3.0-only
/** Shared input guards and generated procedures for assembly mutations. */
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { vbsStr as S, vbsNum as N } from './vbs.js';
import { CATIA_IDENTITY, rigidPlacement } from './transforms.js';

function filePath(value, extension, label, output = false) {
  if (typeof value !== 'string' || /[\u0000-\u001f]/.test(value) || !path.isAbsolute(value) || !extension.test(value)) throw new Error(`${label} must be an absolute CATIA file path`);
  if (output) {
    if (existsSync(value)) throw new Error(`refusing to overwrite ${value}; name a file that does not exist`);
    if (!existsSync(path.dirname(value)) || !statSync(path.dirname(value)).isDirectory()) throw new Error(`destination directory does not exist: ${path.dirname(value)}`);
  } else if (!existsSync(value) || !statSync(value).isFile()) throw new Error(`no such file: ${value}`);
  return path.resolve(value);
}

function name(value, label) {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f]/.test(value) || value.length > 256) throw new Error(`${label} must be a nonempty name without control characters`);
  return value;
}

export function assemblyInputs(args, mode) {
  const product = filePath(args.product, /\.CATProduct$/i, 'product');
  const source = mode === 'remove' ? '' : filePath(mode === 'replace' ? args.withFile : args.component, /\.(CATPart|CATProduct)$/i, mode === 'replace' ? 'withFile' : 'component');
  if (source && realpathSync(product).toLowerCase() === realpathSync(source).toLowerCase()) throw new Error('product and component are the same file');
  const saveAs = args.saveAs === undefined || args.saveAs === '' ? '' : filePath(args.saveAs, /\.CATProduct$/i, 'saveAs', true);
  const placement = mode === 'insert' ? rigidPlacement(args.placement === undefined ? [...CATIA_IDENTITY] : args.placement) : undefined;
  const instanceName = args.instanceName === undefined ? '' : name(args.instanceName, 'instanceName');
  let component = '';
  let componentPath = [];
  let reason = '';
  if (mode !== 'insert') {
    component = name(args.component, 'component');
    if (args.confirm !== component) throw new Error('confirm must repeat the component name exactly');
    reason = name(args.reason, 'reason').trim();
    componentPath = args.componentPath === undefined ? [component] : args.componentPath;
    if (!Array.isArray(componentPath) || componentPath.length < 1 || componentPath.length > 40) throw new Error('componentPath must have 1..40 instance names');
    componentPath.forEach((value) => name(value, 'componentPath entry'));
    if (componentPath.at(-1) !== component) throw new Error('componentPath must end with component');
  }
  return { product, source, saveAs, placement, instanceName, component, componentPath, reason };
}

/** Every mutation is a procedure so a failed COM call can stop before the next destructive step. */
export function assemblyMutationBody(input, mode) {
  const { product, source, saveAs, placement, instanceName, componentPath } = input;
  const lines = [
    'Sub RunAssemblyMutation()',
    '  Dim pd, pr, owner, oldComp, comp, i, j, matches, hit, before, after, oldPos(11), newPos(11), verifyPos(11), names',
    '  AttachCatia',
    '  If gFatal <> "" Then Exit Sub',
    `  Set pd = CATIA.Documents.Open(${S(product)})`,
    `  If Not AsmCheck(${S('Documents.Open ' + path.basename(product))}) Then Exit Sub`,
    '  pd.Activate',
    '  If Not AsmCheck("Document.Activate") Then Exit Sub',
    '  Set pr = pd.Product',
    '  If Not AsmCheck("ProductDocument.Product") Then Exit Sub',
    '  If pr Is Nothing Then',
    '    Fail "not a product document"',
    '    Exit Sub',
    '  End If',
    ...(saveAs ? [
      `  If gFso.FileExists(${S(saveAs)}) Then`,
      '    Fail "saveAs target already exists"',
      '    Exit Sub',
      '  End If',
    ] : []),
    '  Set owner = pr',
  ];
  if (mode !== 'insert') lines.push(
    `  names = Array(${componentPath.map(S).join(', ')})`,
    '  For j = 0 To UBound(names)',
    '    matches = 0 : hit = 0',
    '    For i = 1 To owner.Products.Count',
    '      If owner.Products.Item(i).Name = names(j) Then',
    '        matches = matches + 1 : hit = i',
    '      End If',
    '    Next',
    '    If Not AsmCheck("resolve component path") Then Exit Sub',
    '    If matches <> 1 Then',
    '      Fail "component path must match exactly one instance :: " & names(j)',
    '      Exit Sub',
    '    End If',
    '    If j < UBound(names) Then Set owner = owner.Products.Item(hit)',
    '  Next',
    '  Emit "matched", CStr(hit)',
    '  Set oldComp = owner.Products.Item(hit)',
    '  If Not AsmCheck("resolve old component") Then Exit Sub',
    ...(mode === 'replace' ? [
      '  oldComp.Position.GetComponents oldPos',
      '  If Not AsmCheck("read replacement placement") Then Exit Sub',
    ] : []),
  );
  lines.push('  before = owner.Products.Count', '  Emit "before", CStr(before)');
  if (mode !== 'remove') lines.push(
    `  owner.Products.AddComponentsFromFiles Array(${S(source)}), "All"`,
    '  If Not AsmCheck("AddComponentsFromFiles") Then Exit Sub',
    '  after = owner.Products.Count',
    '  If after <> before + 1 Then',
    '    Fail "insertion must add exactly one component"',
    '    Exit Sub',
    '  End If',
    '  Set comp = owner.Products.Item(after)',
    '  If Not AsmCheck("resolve inserted component") Then Exit Sub',
    ...(mode === 'insert' ? placement.map((v, i) => `  newPos(${i}) = ${N(v)}`) : []),
    `  comp.Position.SetComponents ${mode === 'insert' ? 'newPos' : 'oldPos'}`,
    '  If Not AsmCheck("set component placement") Then',
    '    owner.Products.Remove after',
    '    Chk "rollback inserted component"',
    '    Exit Sub',
    '  End If',
    ...(instanceName ? [
      `  comp.Name = ${S(instanceName)}`,
      '  If Not AsmCheck("rename inserted component") Then',
      '    owner.Products.Remove after',
      '    Chk "rollback inserted component"',
      '    Exit Sub',
      '  End If',
    ] : []),
    '  Emit "inserted", "1"',
    '  Emit "componentName", comp.Name',
    '  Emit "componentPartNumber", comp.PartNumber',
  );
  if (mode !== 'insert') lines.push(
    '  owner.Products.Remove hit',
    '  If Not AsmCheck("Products.Remove") Then',
    ...(mode === 'replace' ? ['    owner.Products.Remove after', '    Chk "rollback replacement insertion"'] : []),
    '    Exit Sub',
    '  End If',
    '  Emit "removed", "1"',
  );
  lines.push(
    '  Emit "after", CStr(owner.Products.Count)',
    '  Emit "added", CStr(owner.Products.Count - before)',
    '  Emit "sessionModified", "true"',
    '  pr.Update',
    '  If Not AsmCheck("Product.Update") Then Exit Sub',
    `  If owner.Products.Count <> before ${mode === 'insert' ? '+ 1' : mode === 'remove' ? '- 1' : ''} Then`,
    '    Fail "unexpected component count after update"',
    '    Exit Sub',
    '  End If',
    ...(mode === 'remove' ? [] : [
      '  comp.Position.GetComponents verifyPos',
      '  If Not AsmCheck("verify component placement") Then Exit Sub',
      '  For i = 0 To 11',
      `    If Abs(CDbl(verifyPos(i)) - CDbl(${mode === 'insert' ? 'newPos' : 'oldPos'}(i))) > 0.000001 Then`,
      '      Fail "component placement changed after product update"',
      '      Exit Sub',
      '    End If',
      '  Next',
      '  Emit "placementVerified", "true"',
    ]),
    ...(saveAs ? [
      `  If gFso.FileExists(${S(saveAs)}) Then`,
      '    Fail "saveAs target appeared during the operation; refusing overwrite"',
      '    Exit Sub',
      '  End If',
      `  pd.SaveAs ${S(saveAs)}`,
      '  If Not AsmCheck("SaveAs") Then Exit Sub',
      '  Emit "savedAs", pd.FullName',
    ] : ['  Emit "savedAs", ""']),
    'End Sub',
    '',
    'Function AsmCheck(tag)',
    '  Chk tag',
    '  AsmCheck = (gFatal = "")',
    'End Function',
    '',
    'RunAssemblyMutation',
  );
  // Error mode is procedure-local; it must be inside this generated procedure.
  lines.splice(1, 0, '  On Error Resume Next');
  return lines.join('\n');
}
