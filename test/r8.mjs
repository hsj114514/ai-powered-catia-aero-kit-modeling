// SPDX-License-Identifier: GPL-3.0-only
/**
 * r8: GSD-first policy findings and the single-closed-solid example.
 *
 * The policy is code-level: model review must flag geometry that analytic GSD could express
 * exactly, must report a declared sampling approximation, and must refuse to treat several
 * independent closed bodies as one gap-free part.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviewModel } from '../lib/model-review.js';

const codes = (elements, errors = []) => reviewModel(elements, errors).findings.map((f) => f.code);
const dense = codes([{ id: 'PLATE', kind: 'surface', params: { sections: Array.from({ length: 17 }, () => [[0, 0, 0], [1, 0, 0]]) } }]);
assert.ok(dense.includes('prefer-native-gsd'), 'a dense sampled loft without a declaration must be flagged: ' + dense.join(','));
const declared = codes([{ id: 'RAMP', kind: 'surface', params: { sections: [[[0, 0, 0], [1, 0, 0]]], approximation: { kind: 'sampled', sections: '17x17', source: 'synthetic analytic approximation' } } }]);
assert.ok(declared.includes('sampled-approximation'), 'a declared approximation must be reported: ' + declared.join(','));
assert.ok(!declared.includes('prefer-native-gsd'), 'a declared approximation replaces the prefer-native finding');
const many = codes([{ id: 'A', kind: 'closed_loft', params: {} }, { id: 'B', kind: 'capped_extrude', params: {} }]);
assert.ok(many.includes('separate-bodies-no-boolean'), 'independent closed bodies must be flagged: ' + many.join(','));
assert.ok(many.includes('matched-caps-volume-required'), 'closed solids keep the matched-caps finding');
const one = codes([{ id: 'A', kind: 'capped_extrude', params: {} }]);
assert.ok(!one.includes('separate-bodies-no-boolean'), 'a single closed solid is not flagged as separate bodies');
const plan = JSON.parse(readFileSync(new URL('../examples/r8-single-foot-rib-solid.plan.json', import.meta.url), 'utf8'));
const solids = plan.steps.filter((s) => s.kind === 'closed_loft' || s.kind === 'capped_extrude');
assert.equal(solids.length, 1, 'the r8 example must build exactly one closed solid');
assert.ok(plan.steps.some((s) => s.kind === 'gsd_api'), 'the outline must use documented native GSD factories');
assert.ok(!plan.steps.some((s) => (s.params?.sections?.length ?? 0) >= 6), 'the r8 example must not use dense sampled lofts');
for (const s of plan.steps) {
  if (s.kind !== 'point') continue;
  for (const key of ['x', 'y', 'z']) assert.equal(typeof s.params[key], 'number', 'point ' + s.id + ' needs a numeric ' + key);
  assert.ok(Number.isFinite(s.params.x) && Number.isFinite(s.params.y) && Number.isFinite(s.params.z), 'point ' + s.id + ' must be finite');
}
console.log('PASS (with D2 dedupe regression): r8 GSD-first findings, single closed solid example, no dense sampling, all points finite.');

// D2 regression: plan-level findings must be reported once, not once per element.
{
  const els = [{ id: 'A', kind: 'capped_extrude', params: {} }, { id: 'B', kind: 'capped_extrude', params: {} }];
  for (let i = 0; i < 20; i++) els.push({ id: 'P' + i, kind: 'point', params: { x: i, y: 0, z: 0 } });
  const list = reviewModel(els, []).findings.filter(f=>!f.id).map((f) => f.code);
  const duplicates = list.filter((c, i) => list.indexOf(c) !== i);
  assert.equal(duplicates.length, 0, 'plan-level findings must not repeat per element: ' + duplicates.join(','));
}
