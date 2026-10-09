// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildToolDefinitions } from '../lib/tools.js';
import { toLossless } from '../lib/validation.js';
import { apply } from '../index.js';

const definitions = buildToolDefinitions({}, {});
function checkSchema(schema) {
  assert.notEqual(typeof schema.required, 'boolean');
  if (schema.required) {
    assert.ok(Array.isArray(schema.required));
    for (const key of schema.required) assert.ok(key in schema.properties);
  }
  for (const property of Object.values(schema.properties ?? {})) checkSchema(property);
  if (schema.items) checkSchema(schema.items);
}
for (const definition of definitions) {
  assert.equal(definition.parameters.type, 'object', definition.name);
  checkSchema(definition.parameters);
}
const airfoil = definitions.find(tool => tool.name === 'catia_airfoil').parameters;
assert.deepEqual(airfoil.required, ['project', 'id', 'chord']);
assert.equal(airfoil.properties.coordinates.items.items.type, 'number');
const wing = definitions.find(tool => tool.name === 'catia_multi_element_wing').parameters;
assert.deepEqual(wing.properties.flaps.items.required, ['chordRatio']);
assert.equal(wing.properties.flaps.items.additionalProperties, false);
const registered = [];
apply({ tools: { register: definition => registered.push(definition) } }, { persona: false });
assert.equal(registered.length, definitions.length);
for (const definition of registered) assert.equal(definition.parameters.type, 'object');

// Optional: validate against the installed DSH implementation without calling CATIA.
if (process.argv[2]) {
  const { assertObjectJsonSchema, validateJsonSchemaValue } = await import(pathToFileURL(process.argv[2]).href);
  for (const definition of registered) assertObjectJsonSchema(definition.parameters);
  assert.deepEqual(validateJsonSchemaValue(airfoil, { project: 'test', id: 'section', chord: 300, naca: '2412' }, ''), []);
  assert.ok(validateJsonSchemaValue(airfoil, { project: 'test', id: 'section' }, '').length > 0);
  assert.ok(validateJsonSchemaValue(airfoil, { project: 'test', id: 'section', chord: '300' }, '').length > 0);
  assert.deepEqual(validateJsonSchemaValue(wing, { project: 'test', id: 'wing', span: 1200, chordRoot: 300, flaps: [{ chordRatio: 0.3 }] }, ''), []);
  assert.ok(validateJsonSchemaValue(wing, { project: 'test', id: 'wing', span: 1200, chordRoot: 300, flaps: [{}] }, '').length > 0);
}
// --- result delivery must be lossless JSON -------------------------------------------------
// The harness rejects undefined properties, non-finite numbers, negative zero, class instances and
// sparse arrays. A successful CATIA build used to be reported as "value is not lossless JSON"
// because a handler left an optional field as undefined.
function strictLossless(node, label, path = label) {
  if (node === null) return;
  const kind = typeof node;
  if (kind === 'string' || kind === 'boolean') return;
  if (kind === 'number') {
    assert.ok(Number.isFinite(node) && !Object.is(node, -0), `${label}: non-lossless number at ${path}`);
    return;
  }
  assert.equal(kind, 'object', `${label}: ${kind} at ${path}`);
  const proto = Object.getPrototypeOf(node);
  assert.ok(Array.isArray(node) || proto === Object.prototype || proto === null, `${label}: non-plain object at ${path}`);
  for (const key of Object.keys(node)) {
    assert.notEqual(node[key], undefined, `${label}: undefined property at ${path}.${key}`);
    strictLossless(node[key], label, `${path}.${key}`);
  }
  if (Array.isArray(node)) for (let index = 0; index < node.length; index += 1) assert.ok(index in node, `${label}: sparse array at ${path}`);
}
const poisoned = [
  { status: 'BLOCKED', project: undefined, errors: ['x'] },
  { min: [0, -0, 0] },
  { value: NaN },
  { value: Infinity },
  { nested: { deeper: undefined } },
  { list: [undefined] },
];
for (const sample of poisoned) strictLossless(toLossless(sample), 'toLossless result');
assert.deepEqual(toLossless({ min: [0, -0, 0] }).min, [0, 0, 0]);
assert.equal('project' in toLossless({ project: undefined }), false);
assert.equal(toLossless({ value: NaN }).value, null);
assert.equal(toLossless(undefined), undefined);
assert.equal(toLossless({ list: [undefined] }).list.length, 1);
// The real boundary, on the exact path that used to fail: an argument rejection used to return a
// result carrying `project: undefined`.
const g2Tool = registered.find((entry) => entry.name === 'catia_g2_solve');
assert.ok(g2Tool, 'catia_g2_solve is registered');
const rejected = await g2Tool.execute({ start: [0, 0, 0], end: [100, 0, 0], tangentStart: [1, 0, 0], tangentEnd: [1, 0, 0], count: 7 });
strictLossless(rejected, 'catia_g2_solve rejection result');
assert.equal(rejected.status, 'BLOCKED');
assert.equal('project' in rejected, false);
console.log(`PASS: ${registered.length} CATIA tool schemas, registration and nested required fields.`);
