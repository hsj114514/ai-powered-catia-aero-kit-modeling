import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildToolDefinitions } from '../lib/tools.js';
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
console.log(`PASS: ${registered.length} CATIA tool schemas, registration and nested required fields.`);
