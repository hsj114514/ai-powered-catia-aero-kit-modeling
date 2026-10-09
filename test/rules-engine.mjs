// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {loadRules,rulesByStatus,evaluateRules,validateRules,candidateForElement} from '../lib/rules-engine.js';
const rules=loadRules(),{hard,unverified}=rulesByStatus(rules);
assert.ok(hard.length>=10&&unverified.length===3);
const warning=evaluateRules({min_ground_clearance:10},rules);assert.equal(warning.rejects.length,0);assert.equal(warning.warnings[0].status,'UNVERIFIED_NOT_ENFORCED');
for(const v of [-5,0,NaN,Infinity,'270',null])assert.ok(evaluateRules({chord:v},rules).rejects.some(r=>r.code==='H05'));
for(const v of [-33,0,15])assert.equal(evaluateRules({aoa:v,twist:0},rules).rejects.length,0);
assert.equal(evaluateRules({overwrite_source:true},rules).rejects[0].code,'H08');
assert.equal(evaluateRules({overwrite_source:'false'},rules).rejects[0].code,'H08');
assert.equal(evaluateRules({unknown_script:true},rules).rejects[0].code,'H09');
assert.ok(evaluateRules({},rules).missing.length>0);assert.notEqual(evaluateRules({},rules).status,'SUCCESS');
assert.equal(evaluateRules({component:'rear_wing',max_height_between_axles:300},rules).warnings.length,0,'component applicability');
const unknown=structuredClone(rules);unknown[3].constraint_type='magic';assert.throws(()=>validateRules(unknown),/unsupported/);
const duplicate=[...rules,rules[0]];assert.throws(()=>validateRules(duplicate),/duplicate/);
const typo=structuredClone(rules);typo[0].verification_status='HARD_CONSTRAIN';assert.throws(()=>validateRules(typo),/verification/);
assert.deepEqual(candidateForElement({kind:'wing',params:{chordRoot:270,span:1160,aoaRoot:-3,twist:-2}}),{kind:'wing',chord:270,span:1160,aoa:-3,twist:-2});
console.log('PASS rules-engine: signed angles and positive lengths separate; invalid inputs fail closed; missing checks explicit; unverified rules advisory; component scope and catalog validation.');
