// SPDX-License-Identifier: GPL-3.0-only
/** r6 regressions use mathematical witnesses and a recording bridge; no CATIA is started. */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { naca4Loop, parseAirfoilText, resolveProfile, wingStations } from '../lib/airfoil.js';
import { elementGeometry, elementBounds, elementFragment, elementContext, expandRequest, orderedElements } from '../lib/ops.js';
import { CATIA_IDENTITY, fromCatiaPosition, composePlacement, rigidPlacement, parseAssemblyRow } from '../lib/transforms.js';
import { checkGeometryRules } from '../lib/rules.js';
import { assemblyInputs, assemblyMutationBody } from '../lib/assembly-ops.js';
import { CatiaBridge, normalizeSettings, safeName, inside } from '../lib/bridge.js';
import { PRELUDE, vbsStr } from '../lib/vbs.js';
import { buildToolDefinitions } from '../lib/tools.js';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(here, 'r6-'));
try {
  const loop = naca4Loop('0012', { count: 40 });
  assert.equal(loop.length, 79);
  assert.equal(loop[0][0], loop.at(-1)[0], 'both finite-thickness TE endpoints are present');
  assert.ok(loop[0][1] > 0 && loop.at(-1)[1] < 0);
  const dat = 'test\n4 4\n0 0\n0.3 0.05\n0.7 0.04\n1 0.001\n0 0\n0.3 -0.05\n0.7 -0.04\n1 -0.001';
  const parsed = parseAirfoilText(dat);
  assert.equal(parsed.format, 'lednicer');
  const resolved = resolveProfile({ coordinates: parsed.points });
  assert.ok(resolved.loop[0][1] > 0 && resolved.loop.at(-1)[1] < 0);
  for (const bad of [null, '', true, NaN, Infinity, 2.5]) assert.throws(() => wingStations({ span: 100, chordRoot: 100, stations: bad }));
  assert.equal(wingStations({ span: 100, chordRoot: 120 }).at(-1).chord, 120);
  assert.throws(() => resolveProfile({ naca: '0012', coordinates: parsed.points }));

  const plate = { id: 'plate', kind: 'endplate', params: { chord: 300, height: 120, sweepDeg: -45, thickness: 2 } };
  assert.equal(elementBounds(plate, {}).max[0], 420, 'rules include swept-back endplate corner');
  assert.ok(elementFragment(plate).includes('420.000000'));
  const chain = expandRequest('multi_element_wing', 'main', { naca: '0012', span: 100, chordRoot: 300, stations: 2, flaps: [{ chordRatio: 0.3 }, { chordRatio: 0.5 }] });
  assert.equal(chain[2].params.parentId, 'main__flap1');
  const elements = Object.fromEntries(chain.map((e) => [e.id, e]));
  assert.deepEqual(orderedElements(Object.fromEntries(chain.slice().reverse().map((e) => [e.id,e]))).map((e) => e.id), chain.map((e) => e.id));
  assert.ok(elementBounds(chain[2], elements).min[0] > elementBounds(chain[1], elements).min[0] + 20);
  const cycle = { a: { id: 'a', kind: 'flap', params: { parentId: 'b', naca: '0012' } }, b: { id: 'b', kind: 'flap', params: { parentId: 'a', naca: '0012' } } };
  assert.throws(() => elementFragment(cycle.a, elementContext(cycle.a, cycle)), /cyclic/);
  const quarter = { id: 'quarter', kind: 'wing', params: { naca: '0012', span: 100, chordRoot: 100, pivot: 'quarterChord', stations: 2 } };
  assert.equal(elementBounds(quarter, {}).min[0], -25);
  assert.equal(elementGeometry(plate).boundsCertified, false, 'interpolated loft bounds are not a containment proof');
  assert.throws(() => elementFragment({ ...plate, params: { outlinePoints: [[0,0],[10,10],[0,10],[10,0]] } }), /self-intersects/);
  const screening = checkGeometryRules({ version: 1, elements: { plate } }, { rules: { maxHeight: 1000 } }, 'p');
  assert.equal(screening.status, 'PARTIAL_SUCCESS');
  assert.deepEqual(screening.uncertainElements, ['plate']);

  const line = { id: 'line', kind: 'line', params: { x1: 0, y1: 400, z1: 0, x2: 2000, y2: 600, z2: 0 } };
  const ledger = { version: 1, elements: { line } };
  assert.equal(checkGeometryRules(ledger, { rules: { headrestBackX: 1000 } }, 'p').status, 'SUCCESS', 'only the aft half exceeds 500 mm');
  const point = { id: 'point', kind: 'point', params: { x: 100, y: 650, z: 0 } };
  assert.equal(checkGeometryRules({ elements: { point } }, { rules: { groundY: 200, maxHeight: 500 } }, 'p').status, 'SUCCESS');
  const diagonal = { id: 'diag', kind: 'line', params: { x1: 0, y1: 0, z1: 0, x2: 100, y2: 100, z2: 0 } };
  assert.equal(checkGeometryRules({ elements: { diag: diagonal } }, { rules: { exclusionZones: [{ min: [0, 90, -1], max: [10, 100, 1] }] } }, 'p').status, 'SUCCESS', 'overlapping boxes do not imply an intersecting exact line');
  assert.equal(checkGeometryRules(ledger, { rules: { groundY: 100 } }, 'p').status, 'BLOCKED');

  const parent = fromCatiaPosition([0, 1, 0, -1, 0, 0, 0, 0, 1, 100, 200, 300]);
  const local = fromCatiaPosition([1,0,0,0,1,0,0,0,1,10,20,30]);
  const world = composePlacement(parent, local);
  assert.deepEqual([world[3],world[7],world[11]], [80,210,330], 'a rotated parent rotates the child translation');
  assert.deepEqual(rigidPlacement([...CATIA_IDENTITY]), [...CATIA_IDENTITY]);
  assert.throws(() => rigidPlacement([1,0,0,0,1,0,0,0,-1,0,0,0]), /reflection/);
  const row = '1|root/wing|wing|part|80|210|330|' + world.join(',') + '|resolved';
  assert.deepEqual(parseAssemblyRow(row).origin, [80,210,330]);
  assert.equal(parseAssemblyRow('1|root/wing|wing|part|||||unresolved').origin, null);
  assert.throws(() => parseAssemblyRow(row.replace('|80|210|330|', '|81|210|330|')), /disagree/);
  const recorded = [];
  const stub = { settings: { maxLevel: 3 }, run: async (req) => { recorded.push(req); return { ok: true, values: { added: '1', removed: '1', inserted: '1', sessionModified: 'true', document: 'asm', root: 'root', walked: '1', truncated: 'false' }, lists: { component: [row] }, errors: [] }; } };
  const tools = buildToolDefinitions(stub, stub.settings);
  const positions = await tools.find((t) => t.name === 'catia_assembly_positions').execute({ project: 'p' });
  assert.equal(positions.status, 'SUCCESS');
  assert.deepEqual(positions.components[0].origin, [80,210,330]);
  assert.ok(recorded.at(-1).body.includes('local(3) = a(9)'));
  assert.ok(recorded.at(-1).body.includes('asmTruncated = True'));
  const product = path.join(tmp, '总装.CATProduct');
  const part = path.join(tmp, '翼面.CATPart');
  writeFileSync(product, ''); writeFileSync(part, '');
  const input = assemblyInputs({ product, component: 'Wing"1', componentPath: ['Sub.1','Wing"1'], withFile: part, confirm: 'Wing"1', reason: 'new geometry' }, 'replace');
  const source = assemblyMutationBody(input, 'replace');
  assert.ok(source.indexOf('AddComponentsFromFiles') < source.indexOf('owner.Products.Remove hit'));
  assert.ok(source.indexOf('comp.Position.SetComponents oldPos') < source.indexOf('owner.Products.Remove hit'));
  assert.ok(source.includes('comp.Position.GetComponents verifyPos'), 'placement is checked again after product update');
  assert.ok(source.includes('"Wing""1"'), 'names are escaped as VBScript data');
  assert.ok(source.includes('matches <> 1'), 'ambiguous names cannot silently select the last match');
  assert.throws(() => assemblyInputs({ product, component: 'Wing', withFile: product, confirm: 'Wing', reason: 'x' }, 'replace'), /same file/);
  const denied = await buildToolDefinitions(stub, { maxLevel: 2 }).find((t) => t.name === 'catia_assembly_remove').execute({ project: 'p', product, component: 'Wing', confirm: 'Wing', reason: 'x' });
  assert.equal(denied.status, 'BLOCKED');
  assert.equal((await tools.find((t) => t.name === 'catia_assembly_positions').execute({ project: 'p', maxDepth: NaN })).status, 'BLOCKED');
  assert.ok(PRELUDE.includes('CreateTextFile(gReportPath, True, True)'));
  assert.ok(vbsStr('a\n"b').includes('ChrW(10)'));
  const report = path.join(tmp, 'report.tsv');
  writeFileSync(report, Buffer.concat([Buffer.from([255,254]), Buffer.from('document\t总装.CATProduct\nRESULT\tok\n','utf16le')]));
  const bridge = new CatiaBridge(normalizeSettings({}, tmp));
  assert.equal(bridge.readReport(report).values.document, '总装.CATProduct');
  const blocked = await new CatiaBridge(normalizeSettings({ maxLevel: 0 }, tmp)).run({ project: 'p', op: 'probe', level: 3, body: '' });
  assert.equal(blocked.blocked, true); assert.deepEqual(blocked.values, {}); assert.ok(blocked.errors.length);
  for (const bad of ['CON', 'a.', '__proto__']) assert.throws(() => safeName(bad, 'id'));
  assert.throws(() => inside(tmp, '..', 'escape'));
  // An emitted feature name alone cannot establish that its final update succeeded.
  const modelBridge = new CatiaBridge(normalizeSettings({}, path.join(tmp, 'model')));
  modelBridge.initLedger('p');
  modelBridge.run = async () => ({ ok: false, values: { feature_probe: 'probe', rolledBack: 'true' }, lists: {}, errors: ['update failed'], durationMs: 1 });
  let modelTools = buildToolDefinitions(modelBridge, modelBridge.settings);
  const failedBuild = await modelTools.find((t) => t.name === 'catia_point').execute({ project: 'p', id: 'probe', x: 0, y: 0, z: 0 });
  assert.equal(failedBuild.status, 'FAILED');
  assert.equal(modelBridge.readLedger('p').elements.probe, undefined);
  modelBridge.run = async () => ({ ok: false, values: { feature_probe: 'probe', geometryReady: 'true' }, lists: {}, errors: ['save failed'], durationMs: 1 });
  const unsaved = await modelTools.find((t) => t.name === 'catia_point').execute({ project: 'p', id: 'probe', x: 0, y: 0, z: 0 });
  assert.equal(unsaved.status, 'PARTIAL_SUCCESS');
  assert.equal(modelBridge.readLedger('p').versions.at(-1).file, null);
  // Clearance must use the selected version's feature names and report missing measurements.
  const savedLedger = modelBridge.readLedger('p');
  const modelFile = path.join(modelBridge.projectPaths('p').dir, 'v1.CATPart');
  writeFileSync(modelFile, '');
  savedLedger.versions = [{ version: 1, file: 'v1.CATPart', status: 'saved', elements: { probe: { features: ['oldProbe'] }, other: { features: ['oldOther'] } } }];
  savedLedger.elements.probe.features = ['newProbe'];
  modelBridge.writeLedger('p', savedLedger);
  const measuredBodies = [];
  modelBridge.run = async (req) => { measuredBodies.push(req.body); return { ok: true, values: {}, lists: {}, errors: [], durationMs: 1 }; };
  const clearance = await modelTools.find((t) => t.name === 'catia_check_clearance').execute({ project: 'p', version: 1, pairs: [{ from: 'probe', to: 'other' }], minDistance: 5 });
  assert.equal(clearance.status, 'PARTIAL_SUCCESS');
  assert.ok(measuredBodies.at(-1).includes('oldProbe') && !measuredBodies.at(-1).includes('newProbe'));
  const inputFile = path.join(tmp, 'screen.json');
  writeFileSync(inputFile, JSON.stringify({ elements: { plate }, constraints: { maxHeight: 1000 } }));
  // No pipes: a sandboxed parent cannot hand its child one, so capture only the exit code here and
  // assert the screening verdict through the same library entry point the CLI calls.
  const cli = spawnSync(process.execPath, [path.join(here, '..', 'scripts', 'geometry-check.mjs'), inputFile], { cwd: tmp, stdio: 'ignore', windowsHide: true });
  assert.equal(cli.status, 2);
  const screened = checkGeometryRules({ elements: { plate }, project: 'offline' }, { rules: { maxHeight: 1000 } }, 'offline');
  assert.equal(screened.screeningOnly, true);
  console.log('PASS: r6 modelling, serial flaps, regional rules, matrix composition, assembly guards, Unicode and transport regressions.');
} finally {
  if (path.dirname(tmp) !== here) throw new Error('Unexpected cleanup target');
  rmSync(tmp, { recursive: true, force: true });
}
