// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { CATIA_KERNEL, requireCapability, kernelStatus, NotImplementedError } from '../lib/catia/index.js';
import { isAvailable, SKETCHER_STATUS } from '../lib/catia/sketcher.js';
import { PART_DESIGN_STATUS, solidFeature, isSolidFeatureAvailable } from '../lib/catia/part-design.js';
for (const name of ['connection','document','parameters','sketcher','gsd','part_design','references','validation','file_safety','rollback']) assert.ok(CATIA_KERNEL[name], 'kernel responsibility missing: ' + name);
const status = kernelStatus();
assert.equal(status.responsibilities, 10);
assert.equal(status.implemented, 10);
assert.deepEqual(status.missing, []);
assert.equal(requireCapability('gsd').implemented, true);
assert.equal(requireCapability('part_design').implemented,true);
assert.throws(() => solidFeature('AddNewPad'), (e) => e instanceof NotImplementedError && e.code === 'F2' && e.hardReject === 'H10');
assert.equal(solidFeature('AddNewAdd').owner,'ShapeFactory');
assert.equal(isSolidFeatureAvailable('AddNewAdd'),true);
assert.equal(isSolidFeatureAvailable('AddNewPad'),false);
assert.equal(isAvailable(), true); assert.ok(/IMPLEMENTED/.test(SKETCHER_STATUS));
assert.equal(PART_DESIGN_STATUS.solids, 'PARTIAL');
console.log('PASS: CATIA kernel facade - partial Part Design coverage matches the actual whitelist; unsupported Pad remains typed NOT_IMPLEMENTED (F2/H10).');
