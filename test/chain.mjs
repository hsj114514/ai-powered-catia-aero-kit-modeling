// SPDX-License-Identifier: GPL-3.0-only
/**
 * Offline geometry tests for chained (serial) multi-element flaps.
 *
 * A flap's gap and overlap are defined against the stage *ahead of it*, so a second flap must anchor
 * to the first flap's trailing edge, not to the wing's. The reader used to leave each flap station
 * carrying its **parent's** trailing edge, which silently produced parallel flaps hinged at the wing
 * (measured on a real build: both flaps' leading edges landed within 0.7 mm of each other). These
 * checks pin the serial behaviour down without needing CATIA, because `elementBounds` is pure
 * geometry.
 *
 * Run from the package directory:  node test/chain.mjs
 */
import assert from 'node:assert/strict';
import { elementBounds, elementContext, elementFragment } from '../lib/ops.js';

const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

const chordOf = (box) => box.max[0] - box.min[0];
const spanZ = (box) => [box.min[2], box.max[2]];

// A wing whose trailing edge sits at a known place, so the chain can be checked by arithmetic.
const wing = {
  id: 'main',
  kind: 'wing',
  params: { naca: '2412', chordRoot: 280, chordTip: 280, aoaRoot: 0, twist: 0, span: 137.2, zStart: 0, stations: 2, xOffset: 0, yOffset: 0 },
};
const elements = { main: wing };

const wingBox = elementBounds(wing, elements);
check('wing builds a finite box', wingBox !== null && Number.isFinite(wingBox.max[0]), JSON.stringify(wingBox));
check('wing trailing edge is at one chord length', Math.abs(wingBox.max[0] - 280) < 1.5, `max X ${wingBox.max[0]}`);

// ---- stage 1: parent is the wing ----
const flap1 = { id: 'flap1', kind: 'flap', params: { parentId: 'main', naca: '2412', chordRatio: 0.357143, deflectionDeg: 25, gap: 14, overlap: 3 } };
elements.flap1 = flap1;
const flap1Box = elementBounds(flap1, elements);
check('flap1 builds a finite box', flap1Box !== null && Number.isFinite(flap1Box.min[0]), JSON.stringify(flap1Box));
check('flap1 chord is the requested fraction of the wing', Math.abs(chordOf(flap1Box) - 280 * 0.357143 * Math.cos(25 * Math.PI / 180)) < 6, `X extent ${chordOf(flap1Box).toFixed(1)}`);
check('flap1 sits behind the wing leading edge', flap1Box.min[0] > wingBox.min[0] + 100, `flap1 min X ${flap1Box.min[0].toFixed(1)}`);
check('flap1 stays within the wing span in Z', spanZ(flap1Box)[0] >= spanZ(wingBox)[0] - 1e-6 && spanZ(flap1Box)[1] <= spanZ(wingBox)[1] + 1e-6, JSON.stringify(spanZ(flap1Box)));

// ---- stage 2: parent is flap1 — the serial case ----
const flap2 = { id: 'flap2', kind: 'flap', params: { parentId: 'flap1', naca: '2412', chordRatio: 0.75, deflectionDeg: 40, gap: 5, overlap: 2 } };
elements.flap2 = flap2;
const flap2Box = elementBounds(flap2, elements);
check('a flap may have a flap parent', flap2Box !== null, 'threw or returned null');
check('flap2 builds a finite box', flap2Box !== null && Number.isFinite(flap2Box.min[0]), JSON.stringify(flap2Box));
// The regression: flap2 must start aft of flap1's leading edge, not at the same place.
check('flap2 anchors to flap1, not to the wing (serial, not parallel)', flap2Box !== null && flap2Box.min[0] > flap1Box.min[0] + 20, `flap2 min X ${flap2Box?.min[0]?.toFixed(1)} vs flap1 min X ${flap1Box.min[0].toFixed(1)}`);
check('flap2 reaches deeper than flap1', flap2Box !== null && flap2Box.min[1] < flap1Box.min[1], `flap2 min Y ${flap2Box?.min[1]?.toFixed(1)} vs flap1 ${flap1Box.min[1].toFixed(1)}`);
check('flap2 chord follows its own parent chord', Math.abs(chordOf(flap2Box) - 100 * 0.75 * Math.cos(65 * Math.PI / 180)) < 12, `X extent ${chordOf(flap2Box).toFixed(1)} (expect ~${(100 * 0.75 * Math.cos(65 * Math.PI / 180)).toFixed(1)})`);

// ---- a three-deep chain must resolve, and the script fragment must reference every stage ----
const flap3 = { id: 'flap3', kind: 'flap', params: { parentId: 'flap2', naca: '2412', chordRatio: 0.5, deflectionDeg: 10, gap: 3, overlap: 1 } };
elements.flap3 = flap3;
const flap3Box = elementBounds(flap3, elements);
check('a three-deep chain resolves', flap3Box !== null && Number.isFinite(flap3Box.min[0]), JSON.stringify(flap3Box));
check('stage 3 anchors aft of stage 2', flap3Box !== null && flap3Box.min[0] > flap2Box.min[0], `${flap3Box?.min[0]?.toFixed(1)} vs ${flap2Box.min[0].toFixed(1)}`);

const fragment = elementFragment(flap3, elementContext(flap3, elements));
check('the CATIA script fragment lists one loft per element', fragment.includes('flap3') && fragment.includes('MakeLoft'), 'fragment missing loft');

// ---- rejected parents must still be rejected, with a message that names the kinds ----
let caught = null;
try {
  elementContext({ id: 'bad', kind: 'flap', params: { parentId: 'pt' } }, { pt: { id: 'pt', kind: 'point', params: { x: 0, y: 0, z: 0 } } });
} catch (error) {
  caught = error;
}
check('a non-wing, non-flap parent is refused', caught !== null && /wing or flap parent/.test(caught.message), caught?.message);
let missing = null;
try {
  elementContext({ id: 'bad2', kind: 'flap', params: { parentId: 'nope' } }, {});
} catch (error) {
  missing = error;
}
check('a missing parent is refused', missing !== null && /missing parent/.test(missing.message), missing?.message);

// ---- backward compatibility: a single flap's own placement must not move ----
const solo = { id: 'solo', kind: 'flap', params: { parentId: 'main', naca: '2412', chordRatio: 0.3, deflectionDeg: 20, gap: 10, overlap: 2 } };
const soloBox = elementBounds(solo, { main: wing, solo });
check('a single flap still anchors to the wing trailing edge', soloBox !== null && Math.abs(soloBox.min[0] - (280 - 2 * Math.cos(20 * Math.PI / 180) - 10 * Math.sin(20 * Math.PI / 180))) < 4, `solo min X ${soloBox?.min[0]?.toFixed(2)}`);

lines.push('');
lines.push(failures === 0 ? 'ALL CHAIN CHECKS PASSED' : `${failures} CHAIN CHECK(S) FAILED`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = failures === 0 ? 0 : 1;
