// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { FAILURE_CLASSES, HARD_REJECT, classifyFailure, classifyMessage, isHardReject, hardReject } from '../lib/failure-taxonomy.js';
for (const k of ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10']) assert.ok(FAILURE_CLASSES[k], 'missing class ' + k);
for (let i = 1; i <= 10; i++) assert.ok(HARD_REJECT['H0' + i] || HARD_REJECT['H' + i] || i === 10, 'H' + i);
assert.ok(isHardReject('H10') && !isHardReject('H99'));
assert.equal(classifyFailure('SetLimitation requires exactly 1 ordered arguments'), 'F1');
assert.equal(classifyFailure('element id already exists: FW_MAIN'), 'F9');
assert.equal(classifyFailure('S_RIB_WIRE / update result :: -2147467259 :: 方法 UpdateObject 失败'), 'F7');
assert.equal(classifyFailure('GetMinimumDistance failed :: 类型不匹配'), 'F3');
assert.equal(classifyFailure('no ledger for this project'), 'F4');
assert.equal(classifyFailure('unknown kind: part_api'), 'F2');
assert.equal(classifyMessage('x1 must be a finite number between -1000000 and 1000000'), 'TOOL_SCHEMA_FAILURE');
const r = hardReject('H10', 'part_api has no builder');
assert.equal(r.status, 'BLOCKED'); assert.equal(r.reject, true);
assert.throws(() => hardReject('H99'));
console.log('PASS: failure taxonomy F1-F10, hard rejects H01-H10, classification on 7 real project error messages.');