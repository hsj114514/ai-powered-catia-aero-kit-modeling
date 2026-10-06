// SPDX-License-Identifier: GPL-3.0-only
/** Geometry-rule checks corresponding to the 2026 T9.3–T9.6 diagram. */
import assert from 'node:assert/strict';
import { buildToolDefinitions } from '../lib/tools.js';

let ledger;
let writes = 0;
const bridge = {
  readLedger: () => ledger,
  withLedger: () => { writes += 1; throw new Error('catia_check_rules must remain read-only'); },
};
const checkRules = buildToolDefinitions(bridge, {}).find((tool) => tool.name === 'catia_check_rules').execute;

async function checkPoint(point, rules) {
  ledger = {
    version: 1,
    constraints: {},
    elements: { probe: { id: 'probe', kind: 'point', params: point } },
  };
  return checkRules({ project: 'diagram-check', rules });
}

// ---- longitudinal limits, measured from the tire datums ----
let result = await checkPoint({ x: 300, y: 100, z: 0 }, { frontTireFrontX: 1000 });
assert.equal(result.errors.some((error) => error.includes('front extent')), false, 'exactly 700 mm ahead is allowed');
result = await checkPoint({ x: 299, y: 100, z: 0 }, { frontTireFrontX: 1000 });
assert.ok(result.errors.some((error) => error.includes('700 mm ahead')), 'more than 700 mm ahead is rejected');

result = await checkPoint({ x: 2250, y: 100, z: 0 }, { rearTireRearX: 2000 });
assert.equal(result.errors.some((error) => error.includes('rear extent')), false, 'exactly 250 mm behind is allowed');
result = await checkPoint({ x: 2251, y: 100, z: 0 }, { rearTireRearX: 2000 });
assert.ok(result.errors.some((error) => error.includes('250 mm behind')), 'more than 250 mm behind is rejected');

// ---- T9.6 250 mm front region ----
result = await checkPoint({ x: 999, y: 251, z: 301 }, { frontAxleX: 1000, frontTireInnerZ: 300 });
assert.ok(result.errors.some((error) => error.includes('T9.6 250 mm height limit')), 'outer front region above 250 mm is rejected');
result = await checkPoint({ x: 999, y: 251, z: 299 }, { frontAxleX: 1000, frontTireInnerZ: 300 });
assert.equal(result.errors.some((error) => error.includes('T9.6 250 mm height limit')), false, 'inboard region is outside the 250 mm restriction');

// ---- headrest plane height limits ----
result = await checkPoint({ x: 100, y: 501, z: 0 }, { headrestBackX: 2000 });
assert.ok(result.errors.some((error) => error.includes('above the 500 mm limit')), 'height ahead of the headrest plane is limited to 500 mm');
result = await checkPoint({ x: 2001, y: 1201, z: 0 }, { headrestBackX: 2000 });
assert.ok(result.errors.some((error) => error.includes('above the 1200 mm limit')), 'height behind the headrest plane is limited to 1200 mm');

// The headrest limits are regional, so a tall element behind the plane must not be blamed for the
// limit that applies ahead of it. The former aggregate form compared the whole-model height against
// both regions at once, which reported exactly that false conflict and could not name an element.
ledger = {
  version: 1,
  constraints: {},
  elements: {
    lowAhead: { id: 'lowAhead', kind: 'point', params: { x: 100, y: 200, z: 0 } },
    tallBehind: { id: 'tallBehind', kind: 'point', params: { x: 2500, y: 1800, z: 0 } },
  },
};
result = await checkRules({ project: 'diagram-check', rules: { headrestBackX: 2000 } });
assert.equal(
  result.errors.some((error) => error.includes('tallBehind') && error.includes('ahead of the headrest plane')),
  false,
  'a tall element behind the plane is not blamed for the ahead-of-plane limit',
);
assert.ok(
  result.errors.some((error) => error.includes('tallBehind') && error.includes('behind the headrest plane')),
  'the tall element behind the plane is reported against the 1200 mm limit, by id',
);
assert.ok(
  result.notes.some((note) => note.includes('Y = 0')),
  'the ground-datum assumption behind the height limits is disclosed in the result',
);

// ---- T9.5 lateral envelope ----
result = await checkPoint({ x: 999, y: 100, z: 501 }, {
  frontAxleX: 1000,
  rearAxleX: 2000,
  frontTireOuterZ: 500,
  rearTireOuterZ: 450,
  rearTireInnerZ: 300,
});
assert.ok(result.errors.some((error) => error.includes('T9.5 limit')), 'front axle lateral envelope follows the outer tire plane');

// ---- aliases and defaults ----
// maxSpan and maxWidth describe the same lateral dimension, so one geometry must not be reported as
// two violations. A point has no extent, so this uses a line spanning 1200 mm in Z.
ledger = {
  version: 1,
  constraints: {},
  elements: { wide: { id: 'wide', kind: 'line', params: { x1: 0, y1: 0, z1: -600, x2: 0, y2: 0, z2: 600 } } },
};
result = await checkRules({ project: 'diagram-check', rules: { maxSpan: 1000, maxWidth: 1000 } });
const spanViolations = result.errors.filter((error) => error.includes('lateral extent'));
assert.equal(spanViolations.length, 1, `one lateral-extent violation, not two (got ${spanViolations.length})`);
assert.ok(spanViolations[0].includes('maxSpan') && spanViolations[0].includes('maxWidth'), 'the single violation names both keys the caller supplied');

// An implicit default must be reported rather than silently applied.
result = await checkPoint({ x: 0, y: 0, z: 0 }, { frontTireFrontX: 1000 });
assert.ok(
  result.notes.some((note) => note.includes('maxAheadOfFrontTire=700')),
  'the applied 700 mm default is disclosed in the result notes',
);

// A datum or an orphan default is not an executed check.
for (const rules of [{ frontAxleX: 1000 }, { maxAheadOfFrontTire: 700 }, { exclusionZones: [] }, { heightZones: [] }, { maxHeightBehindHeadrest: 1200 }]) {
  result = await checkPoint({ x: 2500, y: 1000, z: 0 }, rules);
  assert.equal(result.status, 'BLOCKED', JSON.stringify(rules));
}
for (const value of [null, '', '  ', '500', true, NaN, Infinity, -1]) {
  result = await checkPoint({ x: 0, y: 0, z: 0 }, { maxHeight: value });
  assert.equal(result.status, 'BLOCKED', `invalid height ${value}`);
}
result = await checkPoint({ x: 2500, y: 1000, z: 0 }, { headrestBackX: 2000 });
assert.equal(result.status, 'SUCCESS', 'the diagram permits the rear height region below 1200 mm');
assert.deepEqual(result.checkedRules, ['headrestHeightRegions']);
assert.equal(result.fullCompetitionCompliance, false);
result = await checkPoint({ x: 2500, y: 1000, z: 0 }, { headrestBackX: 2000, maxX: 2000 });
assert.equal(result.status, 'PARTIAL_SUCCESS', 'a separately specified rear stop is still enforced');
ledger.elements.unresolved = { id: 'unresolved', kind: 'unknown', params: {} };
result = await checkRules({ project: 'diagram-check', rules: { maxHeight: 1200 } });
assert.equal(result.status, 'PARTIAL_SUCCESS', 'uncheckable elements must not disappear into a successful result');
assert.deepEqual(result.uncheckedElements, ['unresolved']);
assert.equal(writes, 0, 'rules are not persisted while checking');
console.log('PASS: diagram dimensions, per-element regional limits, aliases, disclosed defaults, and no ledger writes.');
