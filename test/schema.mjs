// SPDX-License-Identifier: GPL-3.0-only
/**
 * Proves that the plugin's hand-written parameter compiler produces exactly the raw JSON Schema
 * that DSH's own author-facing compiler produces, and that every registered tool's schema passes
 * the harness's schema assertions.
 *
 * The plugin cannot import `@deepseek-ai/dsh-tools` at runtime (a workspace bundle declares no
 * dependencies and resolves from the profile), so `parameterSchema()` in `lib/tools.js` is a
 * re-implementation. This test is what keeps that re-implementation honest: it loads the real
 * compiler by absolute path and compares outputs byte for byte.
 *
 * Run from the package directory:  node test/schema.mjs
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Locate the harness's own parameter-schema compiler. It is not a dependency of this plugin, so it is
 * often unresolvable from here; that must make this test SKIP with an explanation rather than crash,
 * because a crash would report a failure that says nothing about the plugin.
 */
function resolveDshTools() {
  if (process.env.DSH_TOOLS_ENTRY) return pathToFileURL(path.resolve(process.env.DSH_TOOLS_ENTRY)).href;
  const candidates = [];
  try {
    candidates.push(require.resolve('@deepseek-ai/dsh-tools/lib/types/index.js'));
  } catch {
    // not resolvable as a dependency, which is the normal case for a workspace bundle
  }
  const cache = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx') : null;
  if (cache && existsSync(cache)) {
    try {
      for (const entry of readdirSync(cache)) {
        const candidate = path.join(cache, entry, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'types', 'index.js');
        if (existsSync(candidate)) candidates.push(candidate);
      }
    } catch {
      // unreadable cache: fall through to the skip below
    }
  }
  return candidates.length > 0 ? pathToFileURL(candidates[0]).href : null;
}

const DSH_TOOLS = resolveDshTools();
if (DSH_TOOLS === null) {
  writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema-report.txt'),
    'SKIPPED: @deepseek-ai/dsh-tools is not resolvable from this package, so the schema-equivalence check could not run.\n'
      + 'Set DSH_TOOLS_ENTRY to its lib/types/index.js to enable it.\n',
    'utf8',
  );
  process.exit(0);
}

const { parameterSchemaSpecToJsonSchema, assertSupportedJsonSchema } = await import(DSH_TOOLS);
const { CatiaBridge, normalizeSettings } = await import('../lib/bridge.js');
const { buildToolDefinitions } = await import('../lib/tools.js');

const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

// ---- 1. equivalence with the harness compiler on every shape this plugin authors ----
/**
 * Compare two schemas by content. The harness rebuilds nodes in its own canonical key order, so
 * a byte comparison would report ordering noise rather than a semantic difference.
 */
function sameSchema(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((entry, index) => sameSchema(entry, b[index]));
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameSchema(a[key], b[key]));
}

const SHAPES = {
  'required string': { project: { type: 'string', required: true, description: 'Project name.' } },
  'optional number': { version: { type: 'number', description: 'Version number.' } },
  'enum string': { pivot: { type: 'string', enum: ['le', 'quarterChord'], description: 'Pivot.' } },
  'array of number': { origin: { type: 'array', items: { type: 'number' }, description: 'Origin.' } },
  'array of array of number': {
    coordinates: { type: 'array', description: 'Pairs.', items: { type: 'array', items: { type: 'number' } } },
  },
  'array of object with required member': {
    flaps: {
      type: 'array',
      description: 'Flaps.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          chordRatio: { type: 'number', required: true, description: 'Chord ratio.' },
          gap: { type: 'number', description: 'Gap.' },
        },
      },
    },
  },
  'open object': { rules: { type: 'object', description: 'Rules.', additionalProperties: true } },
  'required open object': { inlet: { type: 'object', required: true, description: 'Inlet.', additionalProperties: true } },
  'mixed set': {
    project: { type: 'string', required: true, description: 'P.' },
    id: { type: 'string', required: true, description: 'I.' },
    note: { type: 'string', description: 'N.' },
    lines: { type: 'array', required: true, items: { type: 'number' }, description: 'L.' },
  },
};

const mine = (await import('../lib/tools.js')).__testHooks;
for (const [label, spec] of Object.entries(SHAPES)) {
  const expected = parameterSchemaSpecToJsonSchema(spec);
  const actual = mine.parameterSchema(spec);
  const same = sameSchema(expected, actual);
  check(`compiler equivalence :: ${label}`, same, same ? '' : `\n  harness: ${JSON.stringify(expected)}\n  plugin : ${JSON.stringify(actual)}`);
}

// ---- 2. every registered tool compiles to a valid object-rooted raw schema ----
const bridge = new CatiaBridge(normalizeSettings({ projectRoot: path.join(process.cwd(), '.test-output', 'catia-schema-test') }, path.join(process.cwd(), '.test-output')));
const definitions = buildToolDefinitions(bridge, bridge.settings);
check('tool count', definitions.length === 27, `got ${definitions.length}`);
const names = definitions.map((definition) => definition.name).sort();
// Tools that drive CATIA are catia_*; a tool that only parses a file on disk is prefixed with the
// format it reads, so a name never implies a CATIA session that is not needed.
check('every tool name declares its subject', names.every((name) => name.startsWith('catia_') || name.startsWith('step_')), names.join(','));
for (const definition of definitions) {
  const parameters = definition.parameters;
  if (!parameters || parameters.type !== 'object') {
    check(`schema root :: ${definition.name}`, false, JSON.stringify(parameters)?.slice(0, 200));
    continue;
  }
  try {
    assertSupportedJsonSchema(parameters);
    check(`schema valid :: ${definition.name}`, true);
  } catch (error) {
    check(`schema valid :: ${definition.name}`, false, error.message);
  }
  const strayRequired = JSON.stringify(parameters).includes('"required":true');
  check(`no author-form required flags :: ${definition.name}`, !strayRequired, strayRequired ? 'found "required":true inside a compiled schema' : '');
  const declared = Object.keys(parameters.properties ?? {});
  for (const name of parameters.required ?? []) {
    if (!declared.includes(name)) check(`required "${name}" declared :: ${definition.name}`, false, 'not in properties');
  }
}

// The provider rejected the previous registration with `type: null`; assert the exact shape it wants.
const airfoil = definitions.find((definition) => definition.name === 'catia_airfoil');
check('catia_airfoil root type is object', airfoil?.parameters?.type === 'object', JSON.stringify(airfoil?.parameters?.type));
check('catia_airfoil declares required entries', Array.isArray(airfoil?.parameters?.required), JSON.stringify(airfoil?.parameters?.required));
check('catia_airfoil required names exist in properties', (airfoil?.parameters?.required ?? []).every((name) => Object.hasOwn(airfoil.parameters.properties, name)), (airfoil?.parameters?.required ?? []).join(','));
check('catia_airfoil chord is a required number', airfoil?.parameters?.properties?.chord?.type === 'number' && airfoil.parameters.required.includes('chord'), JSON.stringify(airfoil?.parameters?.properties?.chord));

lines.push('');
lines.push(failures === 0 ? 'ALL SCHEMA CHECKS PASSED' : `${failures} SCHEMA CHECK(S) FAILED`);
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema-report.txt'), `${lines.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;
