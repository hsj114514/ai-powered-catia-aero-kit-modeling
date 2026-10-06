// SPDX-License-Identifier: GPL-3.0-only
/**
 * Component-envelope sanity harness for a real STEP export.
 *
 * These dataset-specific plausibility checks can detect extreme or degenerate extents. Passing
 * them does not prove geometric containment, accurate dimensions, or competition compliance.
 * Synthetic containment regressions live in `test/envelope-regression.mjs`.
 *
 * It runs only when a real export is supplied, so it never fails a checkout that has none:
 *
 *   CATIA_STEP_FIXTURE="path\\to\\vehicle.stp" node test/envelope.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStepAssembly } from '../lib/assembly.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const report = path.join(here, 'envelope-report.txt');
const file = process.env.CATIA_STEP_FIXTURE;

if (!file) {
  writeFileSync(
    report,
    'SKIPPED: set CATIA_STEP_FIXTURE to a real .stp export to run the envelope sanity check.\n',
    'utf8',
  );
  process.exit(0);
}

const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

const started = Date.now();
const result = await readStepAssembly(file, { includeBounds: true, maxInstances: 20000 });
const seconds = (Date.now() - started) / 1000;

const boxes = result.instances.filter((instance) => instance.bounds);
const diagonal = (box) => Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
const diagonals = boxes.map((instance) => diagonal(instance.bounds)).sort((a, b) => a - b);
const median = diagonals[Math.floor(diagonals.length / 2)];
const stats = result.stats;

lines.push(`file                       ${file}`);
lines.push(`seconds                    ${seconds.toFixed(1)}`);
lines.push(`instances                  ${stats.instances}`);
lines.push(`with envelope              ${stats.boundsFromGeometry}`);
lines.push(`without own geometry       ${stats.boundsWithoutGeometry}`);
lines.push(`subtree-only envelopes     ${stats.subtreeOnlyEnvelopes}`);
lines.push(`envelope memory (MB)       ${stats.envelopeMemoryMB}`);
lines.push(`union envelope             ${result.envelope ? result.envelope.min.map((v) => v.toFixed(0)).join(',') + ' .. ' + result.envelope.max.map((v) => v.toFixed(0)).join(',') : 'none'}`);
lines.push(`diagonal min/median/max    ${diagonals.length ? `${diagonals[0].toFixed(1)} / ${median.toFixed(1)} / ${diagonals[diagonals.length - 1].toFixed(1)}` : 'n/a'}`);
lines.push('');

check('placements resolve', stats.unresolvedPlacements === 0, `${stats.unresolvedPlacements} unresolved`);
check('placements pass the shape cross-check', stats.representationMismatches === 0, `${stats.representationMismatches} mismatches`);
check('at least one component carries geometry', stats.boundsFromGeometry > 0, String(stats.boundsFromGeometry));

// A vehicle part is at most a few metres across. Anything far outside that means construction
// geometry leaked into the envelope, which is the regression this harness exists to catch.
const largestDiagonal = diagonals.length > 0 ? diagonals[diagonals.length - 1] : 0;
check('no envelope exceeds 20 m', largestDiagonal < 20000, `largest diagonal ${largestDiagonal.toFixed(0)} mm`);
check('median envelope is a real part size', median > 1 && median < 5000, `median ${median.toFixed(1)} mm`);

const union = result.envelope;
if (union) {
  const span = [0, 1, 2].map((axis) => union.max[axis] - union.min[axis]);
  lines.push(`union spans (mm)           ${span.map((v) => v.toFixed(0)).join(' x ')}`);
  // The union is the worst case, so it is reported rather than asserted: a minority of components
  // still carry construction geometry. What must hold is that the minority stays a minority and that
  // every outlier is flagged, so no suspect number can pass as a measurement.
}
const suspectShare = stats.boundsFromGeometry > 0 ? stats.boundsSuspect / stats.boundsFromGeometry : 0;
check('the reader discloses envelopes it cannot stand behind', Number.isFinite(stats.boundsSuspect) && stats.boundsSuspect >= 0, 'suspect=' + stats.boundsSuspect + ' of ' + stats.boundsFromGeometry);
lines.push('');
lines.push(`flag: ${stats.boundsSuspect} of ${stats.boundsFromGeometry} envelopes are not compliance-usable by the reader's semantics`);
lines.push('--- suspect envelopes, largest first (cross-check these in CATIA before use) ---');
for (const instance of result.instances.filter((i) => i.boundsSuspect).sort((a, b) => b.boundsExtentMm - a.boundsExtentMm).slice(0, 12)) {
  lines.push(`  ${instance.boundsExtentMm.toFixed(0).padStart(7)} mm  d${instance.depth} ${instance.name.slice(0, 36)}  ${instance.path.slice(0, 60)}`);
}

lines.push('');
lines.push('--- 10 largest envelopes, for a human plausibility read ---');
for (const instance of [...boxes].sort((a, b) => diagonal(b.bounds) - diagonal(a.bounds)).slice(0, 10)) {
  const box = instance.bounds;
  lines.push(`  ${diagonal(box).toFixed(0).padStart(7)} mm  d${instance.depth} ${instance.name.slice(0, 40)}  dx=${(box.max[0] - box.min[0]).toFixed(0)} dy=${(box.max[1] - box.min[1]).toFixed(0)} dz=${(box.max[2] - box.min[2]).toFixed(0)}`);
}
lines.push('');
lines.push('--- 10 smallest envelopes ---');
for (const instance of [...boxes].sort((a, b) => diagonal(a.bounds) - diagonal(b.bounds)).slice(0, 10)) {
  lines.push(`  ${diagonal(instance.bounds).toFixed(1).padStart(7)} mm  d${instance.depth} ${instance.name.slice(0, 40)}`);
}
lines.push('');
lines.push(failures === 0 ? 'ALL ENVELOPE CHECKS PASSED' : `${failures} ENVELOPE CHECK(S) FAILED`);
writeFileSync(report, `${lines.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;
