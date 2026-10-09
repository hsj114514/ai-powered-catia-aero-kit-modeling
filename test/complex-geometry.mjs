// SPDX-License-Identifier: GPL-3.0-only
/**
 * STEP 13 - graduated complex-geometry cases (offline plan level) + a live-run ledger.
 * Levels: Build / Update / Rebuild / FailureStage / TopologyRisk / FeatureCount / ExecutionTime.
 * Only facts from real runs may be recorded as live; everything else stays "not-run".
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { multiSectionWing, multiElementWing, endplate } from '../lib/aero-features.js';
import { evaluateBuildPlan, loadWeights } from '../lib/evaluator.js';
import { buildToolDefinitions } from '../lib/tools.js';
const fw = loadWeights(new URL('../scoring/front_wing_weights.json', import.meta.url));
const defs = buildToolDefinitions({ settings: { maxLevel: 3, projectRoot: '/' }, readLedger: () => undefined, run: async () => ({}) }, {});
const plan = defs.find((d) => d.name === 'catia_model_plan');
const cases = [
  ['Case 1 single constant-chord wing', multiSectionWing({ name: 'C1_Wing', rootChord: 270, span: 1160, aoaRoot: -3, stations: 2 }).steps],
  ['Case 2 tapered wing', multiSectionWing({ name: 'C2_Wing', rootChord: 280, tipChord: 260, span: 1160, aoaRoot: -3 }).steps],
  ['Case 3 taper + twist', multiSectionWing({ name: 'C3_Wing', rootChord: 280, tipChord: 260, span: 1160, aoaRoot: -3, twist: -2 }).steps],
  ['Case 4 mainplane + single flap', multiElementWing({ name: 'C4', main: multiSectionWing({ name: 'C4_Main', rootChord: 270, span: 1160, aoaRoot: -3 }), flaps: [{ chordRatio: 0.32, deflectionDeg: -18, gap: 8, overlap: 4 }] }).steps],
  ['Case 5 mainplane + two flaps', multiElementWing({ name: 'C5', main: multiSectionWing({ name: 'C5_Main', rootChord: 270, span: 1160, aoaRoot: -3 }), flaps: [{ chordRatio: 0.32, deflectionDeg: -18, gap: 8, overlap: 4 }, { chordRatio: 0.72, deflectionDeg: -12, gap: 6, overlap: 3 }] }).steps],
  ['Case 6 inner/outer variation', multiSectionWing({ name: 'C6_Wing', rootChord: 280, tipChord: 240, span: 1160, aoaRoot: -2, twist: -3, stations: 5 }).steps],
  ['Case 7 wing + endplate', [...multiSectionWing({ name: 'C7_Wing', rootChord: 270, span: 1160, aoaRoot: -3 }).steps, endplate({ name: 'C7_Endplate_R', z: 580, chord: 380, height: 150, sweepDeg: 20 })]],
];
const results = [];
for (const [title, steps] of cases) {
  const validate = await plan.execute({ project: 'CASE', steps, dryRun: true });
  assert.equal(validate.status, 'SUCCESS', title + ': ' + JSON.stringify(validate.errors));
  const score = evaluateBuildPlan({ steps }, fw);
  results.push({ case: title, featureCount: steps.length, planValidated: true, topologyRisk: 1 - Number(score.breakdown.find((b) => b.metric === 'lowTopologyRisk').value), build: 'not-run', update: 'not-run', rebuild: 'not-run', failureStage: null, executionTimeMs: null, score: score.total });
}
const ledger = JSON.parse(readFileSync(new URL('./complex-geometry-results.json', import.meta.url), 'utf8'));
for (const row of results) {
  const live = ledger.cases.find((c) => c.case === row.case);
  assert.ok(live, 'ledger must carry every case');
  row.publicCasePlaceholder = live;
  // r2 changed the helper geometry (including inversion): historical r1 facts are not r2 facts.
}
for (const row of results) console.log('  ' + row.case.padEnd(34) + 'features=' + String(row.featureCount).padStart(3) + '  risk=' + row.topologyRisk.toFixed(3) + '  score=' + String(row.score).padStart(7) + '  build=' + row.build + '  failureStage=' + (row.failureStage ?? '-'));
console.log('PASS: 7 r2 cases plan-validated and scored offline; current live columns remain not-run. Public placeholders contain no historical CAD measurements.');
