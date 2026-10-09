// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { requiresHumanReview } from '../lib/human-review.js';
const ok = requiresHumanReview({ name: 'FW', steps: [{ id: 'Main_Section_01', kind: 'section' }, { id: 'Main_Flap1', kind: 'flap' }] });
assert.equal(ok.required, false); assert.equal(ok.status, 'OK');
const tooManyFlaps = requiresHumanReview({ name: 'FW', steps: [1,2,3,4].map((i) => ({ id: 'F' + i, kind: 'flap' })) });
assert.equal(tooManyFlaps.status, 'HUMAN_REVIEW_REQUIRED');
assert.ok(tooManyFlaps.reasons.some((r) => /fixed topology/.test(r)));
const freeTopology = requiresHumanReview({ name: 'FW', steps: [{ id: 'X', kind: 'magic_surface' }] });
assert.ok(freeTopology.reasons.some((r) => /unknown element kind/.test(r)));
const critical = requiresHumanReview({ name: 'FW_Upright_Bracket', steps: [{ id: 'B', kind: 'wing' }] });
assert.ok(critical.reasons.some((r) => /safety-critical/.test(r)));
const unexplained = requiresHumanReview({ name: 'FW', steps: [{ id: 'A', kind: 'wing' }, { id: 'B', kind: 'flap' }] }, { requireExplanations: true });
assert.equal(unexplained.status, 'HUMAN_REVIEW_REQUIRED');
console.log('PASS: human-review gate flags >3 flaps, free topology, safety-critical keywords and unexplained geometry.');