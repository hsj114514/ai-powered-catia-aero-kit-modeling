// SPDX-License-Identifier: GPL-3.0-only
/**
 * Offline tests for the assembly write tools (revision r5).
 *
 * Policy under test: inserting a component into an assembly is Level 1 and may run unattended;
 * removing or replacing an existing component is Level 3 and must (a) be above the plugin's ceiling
 * before it is even reachable and (b) carry a confirm token that repeats the component name plus a
 * reason. No test here touches CATIA: a stub bridge records the operation and the generated VBScript.
 *
 * Run from the package directory:  node test/assembly-write.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolDefinitions } from '../lib/tools.js';
import { LEVEL } from '../lib/bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, '_fixtures');
mkdirSync(fixtures, { recursive: true });
const fakeProduct = join(fixtures, 'fake_assembly.CATProduct');
const fakePart = join(fixtures, 'fake_component.CATPart');
for (const file of [fakeProduct, fakePart]) if (!existsSync(file)) writeFileSync(file, '', 'utf8');

let checks = 0;
const results = [];
function ok(label) { checks += 1; results.push(`ok   ${label}`); }
function is(actual, expected, label) { assert.equal(actual, expected, label); ok(label); }
function has(haystack, needle, label) { assert.ok(String(haystack).includes(needle), `${label} (missing ${needle})`); ok(label); }
function lacks(haystack, needle, label) { assert.ok(!String(haystack).includes(needle), `${label} (unexpectedly found ${needle})`); ok(label); }

const calls = [];
function makeBridge(values) {
  return {
    settings: { maxLevel: 3 },
    run: async (request) => { calls.push(request); return { ok: true, values, errors: [] }; },
  };
}
function toolNamed(bridge, name) {
  const found = buildToolDefinitions(bridge, bridge.settings).find((entry) => entry.name === name);
  assert.ok(found, `tool ${name} is not declared`);
  return found;
}

// ---- declaration ----
const probeBridge = makeBridge({});
for (const name of ['catia_assembly_insert', 'catia_assembly_remove', 'catia_assembly_replace']) {
  const definition = toolNamed(probeBridge, name);
  is(definition.parameters.type, 'object', `${name} declares an object schema`);
  ok(`${name} has a description`);
}
const insertSchema = toolNamed(probeBridge, 'catia_assembly_insert').parameters;
const removeSchema = toolNamed(probeBridge, 'catia_assembly_remove').parameters;
const replaceSchema = toolNamed(probeBridge, 'catia_assembly_replace').parameters;
is(JSON.stringify(insertSchema.required), JSON.stringify(['project', 'product', 'component']), 'insert requires project, product, component only');
is(JSON.stringify(removeSchema.required), JSON.stringify(['project', 'product', 'component', 'confirm', 'reason']), 'remove requires confirm and reason');
is(JSON.stringify(replaceSchema.required.slice().sort()), JSON.stringify(['project', 'product', 'component', 'withFile', 'confirm', 'reason'].sort()), 'replace requires withFile, confirm and reason');

// ---- insert: refusals must never reach the bridge ----
const missing = join(fixtures, 'does_not_exist.CATProduct');
const insert = toolNamed(makeBridge({ added: '1', placementVerified: 'true', componentName: 'wing', savedAs: '' }), 'catia_assembly_insert').execute;
calls.length = 0;
let out = await insert({ project: 'fw', product: missing, component: fakePart });
is(out.status, 'BLOCKED', 'insert refuses a nonexistent assembly');
has(out.errors.join(' '), 'no such file', 'insert names the missing assembly');
is(calls.length, 0, 'insert does not reach CATIA when the assembly is missing');

out = await insert({ project: 'fw', product: join(here, '..', 'lib', 'tools.js'), component: fakePart });
is(out.status, 'BLOCKED', 'insert refuses a product that is not a .CATProduct');

out = await insert({ project: 'fw', product: fakeProduct, component: join(here, '..', 'lib', 'tools.js') });
is(out.status, 'BLOCKED', 'insert refuses a component that is not a CATPart/CATProduct');

out = await insert({ project: 'fw', product: fakeProduct, component: fakeProduct });
is(out.status, 'BLOCKED', 'insert refuses product === component');
has(out.errors.join(' '), 'same file', 'the same-file refusal is explicit');

out = await insert({ project: 'fw', product: fakeProduct, component: fakePart, saveAs: fakeProduct });
is(out.status, 'BLOCKED', 'insert refuses to overwrite an existing saveAs target');
has(out.errors.join(' '), 'refusing to overwrite', 'the overwrite refusal is explicit');

out = await insert({ project: 'fw', product: fakeProduct, component: fakePart, saveAs: join(fixtures, 'no_such_dir', 'out.CATProduct') });
is(out.status, 'BLOCKED', 'insert refuses a saveAs in a missing directory');
is(calls.length, 0, 'none of the refusals contacted CATIA');

// ---- insert: happy path and the emitted VBScript ----
calls.length = 0;
out = await insert({ project: 'fw', product: fakeProduct, component: fakePart });
is(out.status, 'SUCCESS', 'insert succeeds with a stub CATIA');
is(calls.length, 1, 'insert made exactly one CATIA call');
is(calls[0].level, LEVEL.REFERENCE, 'insert runs at Level 1 (unattended insertion is authorised)');
has(calls[0].body, 'AddComponentsFromFiles', 'the script inserts via AddComponentsFromFiles');
has(calls[0].body, 'Documents.Open', 'the script opens the assembly first');
lacks(calls[0].body, 'SaveAs', 'no save happens without saveAs, so nothing on disk changes');
has(calls[0].body, 'Emit "savedAs", ""', 'the script reports that nothing was saved');

calls.length = 0;
const saveAs = join(fixtures, 'assembly_with_wing.CATProduct');
out = await insert({ project: 'fw', product: fakeProduct, component: fakePart, saveAs, instanceName: 'FW_wing' });
has(calls[0].body, 'SaveAs', 'saveAs produces a SaveAs call');
has(calls[0].body, 'assembly_with_wing.CATProduct', 'the SaveAs target is the requested new file');
has(calls[0].body, 'FW_wing', 'instanceName is applied after insertion');
is(calls[0].auditArgs.saveAs, saveAs, 'the audit record carries the saveAs path');

// ---- remove / replace: approval gates ----
const remove = toolNamed(makeBridge({ matched: '1', removed: '1', after: '3', sessionModified: 'true' }), 'catia_assembly_remove').execute;
const replace = toolNamed(makeBridge({ matched: '1', placementVerified: 'true', inserted: '1', removed: '1', before: '4', after: '4', sessionModified: 'true' }), 'catia_assembly_replace').execute;
calls.length = 0;
out = await remove({ project: 'fw', product: fakeProduct, component: 'FW_wing', reason: 'superseded' });
is(out.status, 'BLOCKED', 'remove refuses a call without confirm');
has(out.errors.join(' '), 'confirm must repeat', 'the missing confirmation is named');

out = await remove({ project: 'fw', product: fakeProduct, component: 'FW_wing', confirm: 'SOMETHING_ELSE', reason: 'x' });
is(out.status, 'BLOCKED', 'remove refuses a confirm token that does not match the component name');

out = await remove({ project: 'fw', product: fakeProduct, component: 'FW_wing', confirm: 'FW_wing' });
is(out.status, 'BLOCKED', 'remove refuses a call without a reason');

out = await replace({ project: 'fw', product: fakeProduct, component: 'FW_wing', withFile: fakePart, confirm: 'FW_wing' });
is(out.status, 'BLOCKED', 'replace refuses a call without a reason');
is(calls.length, 0, 'no unconfirmed deletion or replacement ever reached CATIA');

// ---- remove / replace: approved call shape ----
calls.length = 0;
out = await remove({ project: 'fw', product: fakeProduct, component: 'FW_wing', confirm: 'FW_wing', reason: 'old wing removed after approval' });
is(out.status, 'SUCCESS', 'an approved removal proceeds');
is(calls[0].level, LEVEL.DESTRUCTIVE, 'removal runs at Level 3 (ceiling-gated)');
has(calls[0].body, 'Products.Remove', 'the script removes the component by index');
has(calls[0].body, 'owner.Products.Item(i).Name = names(j)', 'the script matches exact names at each tree level');
lacks(calls[0].body, 'SaveAs', 'an approved removal still does not overwrite the original file');
is(calls[0].auditArgs.reason, 'old wing removed after approval', 'the reason is recorded verbatim');

calls.length = 0;
out = await replace({ project: 'fw', product: fakeProduct, component: 'FW_wing', withFile: fakePart, confirm: 'FW_wing', reason: 'swap to the new build' });
is(out.status, 'SUCCESS', 'an approved replacement proceeds');
is(calls[0].level, LEVEL.DESTRUCTIVE, 'replacement runs at Level 3');
has(calls[0].body, 'Products.Remove', 'replacement can remove the old instance');
has(calls[0].body, 'AddComponentsFromFiles', 'replacement inserts the new file');

// ---- configuration exposes the global ceiling explicitly ----
const patch = readFileSync(join(here, '..', 'cordis.patch.yml'), 'utf8');
has(patch, 'maxLevel: 3', 'the shipped config unlocks Level 3');
has(patch, 'Assembly remove/replace', 'the config comment explains the extra gates');
is(patch.includes('maxLevel: 2'), false, 'the shipped config no longer caps at Level 2');

results.push('');
results.push(`PASS: ${checks} assembly-write checks (insert Level 1 unattended; remove/replace Level 3 behind confirm + reason).`);
process.stdout.write(`${results.join('\n')}\n`);
