// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { HistoryStore, patternKey, PRIOR } from '../lib/history-store.js';
const plan = { steps: [{ kind: 'plane' }, { kind: 'section' }, { kind: 'guide_curve' }, { kind: 'wing' }] };
assert.equal(patternKey(plan), 'plane>section>guide_curve>wing');
const s = new HistoryStore();
assert.equal(s.reliabilityFor(plan), null, 'no samples must give null, never a guessed reliability');
s.record(patternKey(plan), 'success'); s.record(patternKey(plan), 'success'); s.record(patternKey(plan), 'failure');
const q = s.posterior(patternKey(plan));
assert.equal(q.n, 3); assert.equal(q.successes, 2); assert.equal(q.failures, 1);
assert.equal(q.posteriorMean, Number(((PRIOR.alpha + 2) / (PRIOR.alpha + PRIOR.beta + 3)).toFixed(4)));
assert.ok(q.posteriorMean > 0.5, 'two of three successes must sit above the prior mean');
assert.throws(() => s.record('x', 'maybe'));
console.log('PASS: history store is Beta-Binomial (prior ' + PRIOR.alpha + '/' + PRIOR.beta + '), empty history returns null, posterior mean of 2/3 = ' + q.posteriorMean + '.');