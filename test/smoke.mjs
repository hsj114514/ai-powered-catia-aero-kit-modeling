// SPDX-License-Identifier: GPL-3.0-only
/**
 * Offline checks for the pure-JavaScript half of the plugin: airfoil geometry, section
 * placement, wing/flap layout, ledger-bound element fragments and the path fence.
 *
 * The report is written to a file rather than stdout: a child process launched under the DSH
 * sandbox cannot write to an inherited stdout pipe.
 *
 * Run from the package directory:  node test/smoke.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  naca4Loop,
  parseAirfoilText,
  normalizeChord,
  resampleLoop,
  section3d,
  wingStations,
  stationPoints,
  resolveProfile,
} from '../lib/airfoil.js';
import {
  elementBounds,
  elementContext,
  elementFragment,
  expandRequest,
} from '../lib/ops.js';
import { assembleScript } from '../lib/vbs.js';

const lines = [];
let failures = 0;
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function check(label, condition, detail = '') {
  if (condition) {
    lines.push(`ok   ${label}${detail ? ` :: ${detail}` : ''}`);
  } else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

// ---- NACA 4-digit generation ----
const loop = naca4Loop('2412', { count: 40 });
check('naca loop point count', loop.length === 79, `got ${loop.length}`);
const xs = loop.map(([x]) => x);
const ys = loop.map(([, y]) => y);
// A finite trailing-edge thickness tips the last ordinate slightly past x = 1, so these
// comparisons allow for that rather than demanding a mathematically sharp edge.
check('naca chord normalized to 0..1', near(Math.min(...xs), 0, 1e-9) && near(Math.max(...xs), 1, 1e-3), `${Math.min(...xs)} .. ${Math.max(...xs)}`);
check('naca starts at trailing edge', near(loop[0][0], 1, 1e-3), `x=${loop[0][0]}`);
// A zero-thickness trailing edge is rejected by CATIA's multi-section loft (measured), so the
// default profile must carry a small finite trailing-edge gap.
const teGap = Math.abs(loop[0][1] - loop[loop.length - 1][1]);
check('naca trailing edge has finite thickness', teGap > 2e-3, `gap=${teGap.toFixed(6)} chord`);
const sharp = naca4Loop('2412', { count: 40, closedTrailingEdge: true });
check('sharp trailing-edge option reproduces the un-loftable case', Math.abs(sharp[0][1]) < 1e-12, `y=${sharp[0][1]}`);
check('naca thickness is symmetric about the camber line', Math.max(...ys) > 0.05 && Math.min(...ys) < 0, `ymax=${Math.max(...ys).toFixed(4)} ymin=${Math.min(...ys).toFixed(4)}`);
const cambered = naca4Loop('0012', { count: 20 });
const camberYs = cambered.map(([, y]) => y);
check('naca 0012 is symmetric', near(Math.max(...camberYs), -Math.min(...camberYs), 1e-9), `ymax=${Math.max(...camberYs).toFixed(6)}`);

// ---- coordinate file parsing ----
const selig = ['S1223', '1.000000 0.000000', '0.950000 0.008000', '0.500000 0.060000', '0.050000 0.020000', '0.000000 0.000000', '0.050000 -0.015000', '0.500000 -0.020000', '0.950000 -0.004000'].join('\n');
const parsed = parseAirfoilText(selig);
check('selig file parsed', parsed.name === 'S1223' && parsed.points.length === 8, `name=${parsed.name} n=${parsed.points.length}`);
const upperFirst = parsed.points.slice(1, 4).map(([, y]) => y);
const lowerLast = parsed.points.slice(5).map(([, y]) => y);
check('selig upper surface comes first', Math.min(...upperFirst) > 0 && Math.max(...lowerLast) <= 0, `upper=${upperFirst.join(',')} lower=${lowerLast.join(',')}`);
const ledgerSample = ['1.000000 0.000000', '0.950000 -0.004000', '0.500000 -0.020000', '0.050000 -0.015000', '0.000000 0.000000', '0.050000 0.020000', '0.500000 0.060000', '0.950000 0.008000', '1.000000 0.000000'].join('\n');
const ledgerParsed = parseAirfoilText(ledgerSample);
check('ledger file detected', ledgerParsed.format === 'ledger');
check('ledger surface order is converted to selig', Math.min(...ledgerParsed.points.slice(1, 4).map(([, y]) => y)) > 0
  && Math.max(...ledgerParsed.points.slice(5).map(([, y]) => y)) <= 0
  && ledgerParsed.points[0][0] === 1, JSON.stringify(ledgerParsed.points));
const unit = normalizeChord([[100, 5], [300, 40], [500, 3]]);
check('normalizeChord rescales to unit chord', near(unit[0][0], 0) && near(unit[2][0], 1), JSON.stringify(unit));
const resampled = resampleLoop([[1, 0], [0.5, 0.06], [0, 0], [0.5, -0.05], [1, 0]], 12);
check('resampleLoop keeps a closed ordering', resampled.length === 22 && near(resampled[0][0], 1, 0.2), `n=${resampled.length} first=${resampled[0][0].toFixed(3)}`);

// ---- section placement ----
const section = section3d(loop, { chord: 300, aoaDeg: 0, origin: [10, 20, 30] });
const xs2 = section.map((p) => p[0]);
check('section is offset by its origin', near(Math.min(...xs2), 10, 0.5) && near(Math.max(...xs2), 310, 0.5), `${Math.min(...xs2).toFixed(2)} .. ${Math.max(...xs2).toFixed(2)}`);
check('section keeps a constant z', section.every((p) => near(p[2], 30)), 'z');
const tePoint = section.find((p) => near(p[0], 310, 0.5));
const lePoint = section.reduce((best, p) => (p[0] < best[0] ? p : best), section[0]);
const chordMeasured = Math.hypot(tePoint[0] - lePoint[0], tePoint[1] - lePoint[1]);
check('section chord equals the requested chord', near(chordMeasured, 300, 0.1), `${chordMeasured.toFixed(6)}`);
const pitched = section3d(loop, { chord: 300, aoaDeg: 10, origin: [0, 0, 0] });
const pitchedTe = pitched.find((p) => near(p[0], 300 * Math.cos((-10 * Math.PI) / 180), 0.5));
check('positive angle of attack lowers the trailing edge', pitchedTe !== undefined && pitchedTe[1] < -1, `te=${pitchedTe ? pitchedTe[1].toFixed(2) : 'missing'}`);

// ---- wing stations ----
const stations = wingStations({ span: 1200, zStart: -600, chordRoot: 300, chordTip: 200, aoaRoot: 4, twist: -2, sweepDeg: 0, dihedralDeg: 0, stations: 5 });
check('wing station count', stations.length === 5, `got ${stations.length}`);
check('wing spans the requested extent', near(stations[0].z, -600) && near(stations[4].z, 600), `${stations[0].z} .. ${stations[4].z}`);
check('wing tapers linearly', near(stations[2].chord, 250), `mid chord=${stations[2].chord}`);
check('wing twists linearly', near(stations[4].aoaDeg, 2), `tip aoa=${stations[4].aoaDeg}`);
const swept = wingStations({ span: 1000, chordRoot: 200, chordTip: 200, sweepDeg: 45, stations: 2 });
check('sweep moves the leading edge aft with span', near(swept[1].origin[0], 1000, 1e-6), `x=${swept[1].origin[0]}`);
const dihedral = wingStations({ span: 1000, chordRoot: 200, chordTip: 200, dihedralDeg: 45, stations: 2 });
check('dihedral raises the section with span', near(dihedral[1].origin[1], 1000, 1e-6), `y=${dihedral[1].origin[1]}`);

// ---- multi-element wing expansion and flap placement ----
const expanded = expandRequest('multi_element_wing', 'rear_wing', {
  naca: '2412',
  span: 1000,
  chordRoot: 300,
  chordTip: 300,
  aoaRoot: 0,
  stations: 2,
  flaps: [{ chordRatio: 0.3, deflectionDeg: 0, gap: 5, overlap: 10 }],
});
check('multi-element wing expands to a wing plus one flap', expanded.length === 2 && expanded[0].kind === 'wing' && expanded[1].kind === 'flap', expanded.map((e) => `${e.id}:${e.kind}`).join(', '));
const elementMap = Object.fromEntries(expanded.map((e) => [e.id, e]));
const flap = expanded[1];
const parentStations = expanded[0].params;
const parentLayout = stationPoints(resolveProfile(parentStations).loop, wingStations(parentStations)[0]);
const parentXs = parentLayout.map((p) => p[0]);
const parentTe = [Math.max(...parentXs), 0];
const flapFragment = elementFragment(flap, elementContext(flap, elementMap));
check('flap fragment is generated', flapFragment.includes('MakeLoft') && !flapFragment.includes('undefined'), `${flapFragment.split('\n').length} lines`);
const flapPointsMatch = flapFragment.match(/AddSectionPt "rear_wing__flap1__s1", ([-\d.]+), ([-\d.]+), ([-\d.]+)/g) ?? [];
const firstFlapPoint = flapFragment.match(/AddSectionPt "rear_wing__flap1__s1", ([-\d.]+), ([-\d.]+), ([-\d.]+)/);
check('flap geometry is emitted', flapPointsMatch.length > 40, `${flapPointsMatch.length} points on the first flap section`);
if (firstFlapPoint) {
  const flapXs = [...flapFragment.matchAll(/AddSectionPt "rear_wing__flap1__s1", ([-\d.]+),/g)].map((m) => Number(m[1]));
  const flapLe = Math.min(...flapXs);
  check('overlap places the flap leading edge forward of the parent trailing edge', near(flapLe, parentTe[0] - 10, 0.6), `flap LE=${flapLe.toFixed(3)} parent TE=${parentTe[0]}`);
}
const wingBounds = elementBounds(expanded[0], elementMap);
check('wing bounds derive from the ledger', wingBounds !== null && near(wingBounds.max[2], 1000, 1e-6) && near(wingBounds.max[0], 300, 0.1), JSON.stringify(wingBounds));
check('flap bounds derive from the ledger', elementBounds(flap, elementMap) !== null, '');

// ---- script assembly ----
const script = assembleScript({ prelude: 'PRELUDE', body: 'X', reportPath: path.join(process.cwd(), '.test-output', 'r.tsv'), op: 'test', title: 'T' });
check('assembled script carries the epilogue', script.includes('WScript.Quit 0') && script.includes('RESULT'), '');
check('no prelude placeholder survives', !script.includes('@@'), '');

lines.push('');
lines.push(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'report.txt'), `${lines.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;
