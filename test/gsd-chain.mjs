// SPDX-License-Identifier: GPL-3.0-only
/**
 * v1.2.0 r1 - GSD five-layer chain proof (offline, code level).
 *
 * Verifies, without CATIA, that for every GSD capability in the upgrade specification:
 *   Schema  - a strict object schema with additionalProperties:false
 *   Registered - the driving tool exists in buildToolDefinitions()
 *   Handler - every definition carries an execute function
 *   Adapter - lib/gsd-api.js builds its table from lib/gsd-catalog.json and resolves by name
 *   Call    - the adapter emits a real factory call (checked as text) and the catalog entry has
 *             documented slots and a documentation URL
 * Live status (which capabilities have actually run on CATIA) is a separate ledger, deliberately
 * NOT inferred here: "declared" is not "verified".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildToolDefinitions } from '../lib/tools.js';

const defs = buildToolDefinitions({ settings: { maxLevel: 3 }, readLedger: () => undefined, run: async () => ({}) }, {});
for (const d of defs) {
  assert.equal(d.parameters.type, 'object', d.name + ': top-level type');
  assert.ok(d.parameters.properties && typeof d.parameters.properties === 'object', d.name + ': properties');
  assert.equal(d.parameters.additionalProperties, false, d.name + ': additionalProperties must be false');
  assert.equal(d.parameters.type === 'object' && d.parameters.properties !== null, true, d.name + ': no null schema');
  assert.equal(typeof d.execute, 'function', d.name + ': handler');
}
for (const name of ['catia_gsd_operation', 'catia_gsd_split', 'catia_gsd_catalog', 'catia_model_plan', 'catia_closed_loft', 'catia_capped_extrude', 'catia_point', 'catia_line', 'catia_plane', 'catia_guide_curve', 'catia_surface', 'catia_wing']) {
  assert.ok(defs.some((d) => d.name === name), 'driving tool missing: ' + name);
}
const adapter = readFileSync(new URL('../lib/gsd-api.js', import.meta.url), 'utf8');
assert.ok(/catalog\.factories/.test(adapter), 'adapter must derive its table from the catalog');
assert.ok(/factories\.get\(|factories\[/.test(adapter), 'adapter must resolve a factory by documented method name');
assert.ok(/HybridShapeFactory|ShapeFactory/.test(adapter), 'adapter must emit a real factory call');
const catalog = JSON.parse(readFileSync(new URL('../lib/gsd-catalog.json', import.meta.url), 'utf8'));
const caps = {
  Point: /^AddNewPoint/, Line: /^AddNewLine/, Plane: /^AddNewPlane/, Direction: /^AddNewExtrude/,
  Spline: /^AddNewSpline/, Curve: /^AddNewSpline/, MultiSectionSurface: /^AddNewLoft/,
  Sweep: /^AddNewSweep/, ExtrudeSurface: /^AddNewExtrude/, Intersection: /^AddNewIntersection/,
  Projection: /^AddNewProject/, Boundary: /^AddNewBoundary/, Split: /^AddNewHybridSplit/,
  Trim: /^AddNewHybridTrim/, Join: /^AddNewJoin/, Extrapolate: /^AddNewExtrapol/, Offset: /^AddNewOffset/,
};
// capabilities that have actually been executed on CATIA in this project (live ledger)
const liveVerified = ['Point', 'Line', 'Plane', 'Spline', 'MultiSectionSurface', 'ExtrudeSurface', 'Join', 'Offset', 'Direction'];
const lines = [];
for (const [capability, pattern] of Object.entries(caps)) {
  const entry = catalog.factories.find((f) => pattern.test(f.method));
  assert.ok(entry, 'no documented factory for ' + capability);
  assert.ok(Array.isArray(entry.slots), capability + ': slots');
  assert.ok(/^https:\/\//.test(entry.documentation ?? ''), capability + ': documentation URL');
  lines.push('  ' + capability.padEnd(22) + entry.method.padEnd(30) + 'slots=' + String(entry.slots.length).padEnd(4) + (liveVerified.includes(capability) ? 'historical r1 report only; r2 NOT live-verified' : 'code-only, NOT live-verified'));
}
assert.ok(!catalog.factories.some((f) => /^(AddNewPad|AddNewPocket|AddNewHole|AddNewShell|AddNewSketch|AddComponent)$/.test(f.method)), 'Part/Assembly/Sketcher factories must not be claimed');
console.log('PASS: ' + defs.length + ' strict object schemas; five-layer chain present for ' + lines.length + ' GSD capabilities (offline; live status is a ledger, not inferred).');
for (const l of lines) console.log(l);
