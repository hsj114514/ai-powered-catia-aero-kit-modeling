// SPDX-License-Identifier: GPL-3.0-only
/**
 * catia_model_plan `planFile` contract (offline; no CATIA, no ledger write).
 *
 * A 63-step front-wing plan is far too large to pass as an inline `steps` array, so the tool also
 * accepts an absolute path to a `.plan.json`. These checks pin the contract: absolute, `.json`,
 * existing, bounded, JSON object with a steps array, mutually exclusive with steps, project must
 * match; file dryRun is inherited only when the call omits it, explicit arguments take precedence.
 *
 * Optional: set FW_QY_TESTSET to a front-wing test-set directory and the four delivered plans
 * (01..04, 63/30/3/10 steps) are validated through the same validators.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildToolDefinitions } from '../lib/tools.js';

const dir = mkdtempSync(path.join(tmpdir(), 'plan-file-'));
const bridge = { settings: { maxLevel: 3 }, readLedger: () => undefined, run: async () => ({ ok: true, values: {}, errors: [] }) };
const plan = buildToolDefinitions(bridge, {}).find((entry) => entry.name === 'catia_model_plan');
assert.ok(plan, 'catia_model_plan is registered');
function write(name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  return file;
}
const okSteps = [
  { id: 'P1', kind: 'point', params: { x: 0, y: 0, z: 0 } },
  { id: 'P2', kind: 'point', params: { x: 1, y: 0, z: 0 } },
];
const good = write('good.plan.json', { project: 'PLAN_FILE_TEST', dryRun: true, steps: okSteps });
async function blocked(args, needle) {
  const result = await plan.execute(args);
  assert.equal(result.status, 'BLOCKED', 'expected BLOCKED, got ' + result.status + ' for ' + needle);
  assert.ok(JSON.stringify(result.errors).includes(needle), 'expected an error mentioning ' + needle + ', got ' + JSON.stringify(result.errors));
}
await blocked({ project: 'PLAN_FILE_TEST', steps: okSteps, planFile: good }, 'either steps or planFile');
await blocked({ project: 'PLAN_FILE_TEST', planFile: 'relative.plan.json' }, 'absolute path');
await blocked({ project: 'PLAN_FILE_TEST', planFile: path.join(dir, 'missing.plan.json') }, 'not found');
await blocked({ project: 'PLAN_FILE_TEST', planFile: write('not-json.plan.json', '{oops') }, 'not valid JSON');
await blocked({ project: 'PLAN_FILE_TEST', planFile: write('no-steps.plan.json', { project: 'PLAN_FILE_TEST' }) }, 'steps array');
await blocked({ project: 'PLAN_FILE_TEST', planFile: write('wrong-ext.txt', { steps: okSteps }) }, '.json file');
await blocked({ project: 'PLAN_FILE_TEST', planFile: write('too-many.plan.json', { steps: Array.from({ length: 2049 }, (_, index) => ({ id: 'S' + index, kind: 'point', params: { x: index, y: 0, z: 0 } })) }) }, '1..2048');
await blocked({ project: 'PLAN_FILE_TEST', planFile: write('other-project.plan.json', { project: 'SOMEWHERE_ELSE', steps: okSteps }) }, 'but this call targets');
const dry = await plan.execute({ project: 'PLAN_FILE_TEST', planFile: good, dryRun: true });
assert.equal(dry.status, 'SUCCESS');
assert.deepEqual(dry.elements, ['P1', 'P2']);
assert.equal(dry.screeningOnly, true);
assert.ok(Array.isArray(dry.notes) && dry.notes.join(' ').includes('dryRun=true'), 'the plan file dryRun is reported back');
const dry2 = await plan.execute({ project: 'PLAN_FILE_TEST', planFile: write('no-project.plan.json', { steps: okSteps }), dryRun: true });
assert.equal(dry2.status, 'SUCCESS');
assert.ok(dry2.notes.join(' ').includes('dryRun=undefined'), 'a plan without dryRun is reported as undefined');
const inherited = await plan.execute({ project: 'PLAN_FILE_TEST', planFile: good });
assert.equal(inherited.status,'SUCCESS');
assert.equal(inherited.screeningOnly,true,'dryRun:true from a file must not start a live build when the call omits dryRun');
await blocked({project:'PLAN_FILE_TEST',planFile:write('bad-dry.plan.json',{steps:okSteps,dryRun:'true'}),dryRun:true},'dryRun must be a boolean');
let overrides=0;
bridge.withLedger=()=>{overrides++;throw new Error('LIVE_OVERRIDE_WITNESS');};
const overridden=await plan.execute({project:'PLAN_FILE_TEST',planFile:good,dryRun:false});
assert.equal(overrides,1,'an explicit false must override file true');
assert.ok(overridden.errors.join(' ').includes('LIVE_OVERRIDE_WITNESS'));
let real = 0;
const testset = process.env.FW_QY_TESTSET;
if (testset) {
  const cases = [['03-wings-only.plan.json', 'FW_QY_R3_WINGS', 3], ['04-round-r4-r6.plan.json', 'FW_QY_R3_ROUND', 10], ['02-right-endplate.plan.json', 'FW_QY_R3_RIGHT', 30], ['01-front-wing-full.plan.json', 'FW_QY_R3_FULL', 63]];
  for (const [file, project, count] of cases) {
    const result = await plan.execute({ project, planFile: path.join(testset, file), dryRun: true });
    assert.equal(result.status, 'SUCCESS', file + ' should validate: ' + JSON.stringify(result.errors));
    assert.equal(result.elements.length, count, file + ' element count');
    real += 1;
  }
}
console.log('PASS: catia_model_plan planFile contract' + (real ? ' + ' + real + ' delivered test-set plans' : '') + ' (offline).');
if(realpathSync(path.dirname(dir))!==realpathSync(tmpdir())||!path.basename(dir).startsWith('plan-file-'))throw new Error('Unexpected test cleanup target');
rmSync(dir,{recursive:true,force:true});
