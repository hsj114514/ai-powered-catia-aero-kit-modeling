// SPDX-License-Identifier: GPL-3.0-only
/**
 * v1.2.0 r8 - Boolean (AddNewAdd) source Body resolution.
 * A solid built with newBody:true lives in a Body that the solid emitter renames "<elementId>__body",
 * but the gsd_api "Body" slot used gFeats(ref).Parent, which does not return that Body on this CATIA
 * build: every AddNewAdd step failed with "Boolean source must belong to an independent Body" and its
 * union reported no volume. The emitter must look the Body up by its recorded name, keeping .Parent as
 * a fallback. These are emitted-script assertions only - nothing here is live-verified.
 */
import assert from 'node:assert/strict';
import { apiElement } from '../lib/gsd-api.js';
import { gsdElement } from '../lib/solid-ops.js';

const solid = gsdElement({ id: 'R_SHOULDER_SOLID', kind: 'gsd', params: { op: 'solid_close', from: ['R_SHOULDER_SHELL'] } }, '', { newBody: true });
assert.ok(solid.includes('R_SHOULDER_SOLID__body'), 'the solid emitter must still rename its own Body');

const union = apiElement({ id: 'R_FRONT_UNION_1', kind: 'gsd_api', params: { factory: 'AddNewAdd', arguments: [{ ref: 'R_SHOULDER_SOLID' }], bodySource: 'R_MAIN_WALL_SOLID' } });
assert.ok(union.includes('For Each '), 'the Body slot must scan gPart.Bodies');
assert.ok(union.includes(' In gPart.Bodies'), 'the scan must iterate gPart.Bodies');
assert.ok(union.includes('.Name = "R_SHOULDER_SOLID__body"'), 'it must match the Body name the emitter recorded');
assert.ok(union.includes(' = gFeats("R_SHOULDER_SOLID").Parent'), '.Parent must remain a fallback');
assert.ok(union.includes('Boolean source must belong to an independent Body'), 'the explicit failure must be kept');
assert.ok(union.includes('gPart.InWorkObject = gFeats("R_MAIN_WALL_SOLID")'), 'the explicit target Body is still activated');

const lines = union.split(/\r?\n/);
const scanAt = lines.findIndex((l) => l.includes(' In gPart.Bodies'));
const nameAt = lines.findIndex((l) => l.includes('.Name = "R_SHOULDER_SOLID__body"'));
const nextAt = lines.findIndex((l, i) => i > scanAt && l.trim() === 'Next');
assert.ok(scanAt >= 0 && nameAt === scanAt + 1, 'the name test must sit directly inside the scan');
assert.ok(nextAt === scanAt + 2, 'no guard line may be inserted inside the For/Next block');
assert.ok(union.includes('.Name = "R_MAIN_WALL_SOLID__body"'), 'the target Body must be resolved by name too');
assert.ok(union.includes('Then gFeats.Add "R_FRONT_UNION_1__body", targetBody'), 'the merged Body handle must be registered for chained unions');
console.log('PASS: AddNewAdd resolves source AND target Bodies by recorded name, registers the merged Body handle for chained unions, keeps .Parent fallbacks and the explicit failures.');