// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {perturbationGrid,computeRebuildSuccessRate,recordRebuild} from '../lib/rebuild-test.js';
assert.equal(perturbationGrid().length,20);assert.ok(perturbationGrid().every(r=>r.mode));
assert.equal(computeRebuildSuccessRate([]).rate,null);
const evidence=id=>({source:'CATIA',runId:id,updated:true,validated:true,rolledBack:true});
const mixed=computeRebuildSuccessRate([recordRebuild('chord',.05,'pass','',evidence('1')),recordRebuild('chord',-.1,'failed','UpdateObject E_FAIL',evidence('2')),recordRebuild('aoa',1,'pass','',evidence('3')),{status:'not-run'}]);
assert.equal(mixed.executed,3);assert.equal(mixed.rate,.6667);
assert.equal(computeRebuildSuccessRate([{status:'updated',...evidence('4')}]).rate,0,'Update alone is not rebuild success');
assert.equal(computeRebuildSuccessRate([{status:'pass'}]).rate,null,'unattributed result is not a real run');
assert.equal(computeRebuildSuccessRate([{status:'pass',...evidence('5'),rolledBack:false}]).rate,0);
assert.throws(()=>computeRebuildSuccessRate([{status:'unknown'}]),/status/);
assert.throws(()=>computeRebuildSuccessRate([{status:'pass',...evidence('1')},{status:'pass',...evidence('1')}]),/duplicate/);
console.log('PASS rebuild: 20 explicit relative/degree perturbations, attributable attempts, full success stages, duplicates/invalid records rejected.');
