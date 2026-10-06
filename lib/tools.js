// SPDX-License-Identifier: GPL-3.0-only
/**
 * Model-facing tools.
 *
 * Ledger-based modelling rebuilds into a new numbered working copy. Assembly mutations instead
 * edit a CATIA session and optionally save a new product file; a later failure can leave that
 * session modified. Existing files are refused by the assembly saveAs guard.
 *
 * @module lib/tools
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LEVEL, LEVEL_LABEL, SCRATCH_PROJECT, safeName } from './bridge.js';
import { assemblyInputs, assemblyMutationBody } from './assembly-ops.js';
import { parseAssemblyRow } from './transforms.js';
import { integerOption } from './validation.js';
import { checkGeometryRules } from './rules.js';
import { readStepAssembly } from './assembly.js';
import { vbsStr as S, vbsNum as N } from './vbs.js';
import {
  elementBounds,
  EDITABLE,
  KIND_LEVEL,
  elementContext,
  elementFragment,
  expandRequest,
  orderedElements,
} from './ops.js';

/** Model frame convention, stated once and referenced by the tools that take coordinates. */
const FRAME = 'millimetres in the project frame: +X aft along the chord, +Y up, +Z outboard';

/** Output schema shared by every tool here: a status object the renderer formats. */
const OUT = { type: 'object', additionalProperties: true };

/**
 * Build the text a model reads after a call.
 * @param value - the tool result.
 * @returns one text block.
 */
function render(value) {
  const lines = [`Status: ${value.status} (${LEVEL_LABEL[value.level] ?? `Level ${value.level}`})`];
  if (value.project) lines.push(`Project: ${value.project}`);
  if (value.version !== undefined && value.version !== null) lines.push(`Version: ${value.version}`);
  if (value.file) lines.push(`File: ${value.file}`);
  if (Array.isArray(value.elements) && value.elements.length > 0) {
    lines.push(`Elements: ${value.elements.join(', ')}`);
  }
  if (value.detail) lines.push(value.detail);
  if (value.metrics) {
    for (const [key, metric] of Object.entries(value.metrics)) lines.push(`${key}: ${metric}`);
  }
  if (Array.isArray(value.errors) && value.errors.length > 0) {
    lines.push('Problems:');
    for (const error of value.errors.slice(0, 8)) lines.push(`- ${error}`);
    if (value.errors.length > 8) lines.push(`- (${value.errors.length - 8} more, see the audit journal)`);
  }
  if (Array.isArray(value.notes) && value.notes.length > 0) {
    for (const note of value.notes) lines.push(note);
  }
  if (Array.isArray(value.items) && value.items.length > 0) {
    lines.push('Items:');
    for (const item of value.items.slice(0, 60)) lines.push(`- ${item}`);
    if (value.items.length > 60) lines.push(`- (${value.items.length - 60} more)`);
  }
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Convert author-facing property maps to raw JSON Schema for tools.register(). */
function parameterSchema(properties) {
  const required = [];
  const converted = Object.fromEntries(Object.entries(properties).map(([key, value]) => {
    if (value.required === true) required.push(key);
    return [key, valueSchema(value)];
  }));
  return { type: 'object', properties: converted, ...(required.length ? { required } : {}) };
}

function valueSchema(value) {
  const { required, ...schema } = value;
  if (schema.properties) {
    const converted = parameterSchema(schema.properties);
    schema.properties = converted.properties;
    if (converted.required) schema.required = converted.required;
  }
  if (schema.items) schema.items = valueSchema(schema.items);
  return schema;
}

/** Wrap a tool body in the shared definition shape. */
function tool(name, description, parameters, execute, options = {}) {
  return {
    name,
    description,
    parameters: parameterSchema(parameters),
    output: { schema: OUT, render: (_args, value) => render(value) },
    execute: async (args) => {
      try { return await execute(args ?? {}); }
      catch (error) { return { status: error.code ? 'FAILED' : 'BLOCKED', level: options.level ?? (name === 'catia_assembly_remove' || name === 'catia_assembly_replace' ? LEVEL.DESTRUCTIVE : LEVEL.REFERENCE), project: typeof args?.project === 'string' ? args.project : undefined, errors: [error.message] }; }
    },
    isConcurrencySafe: () => false,
    timeoutMs: options.timeoutMs ?? 900000,
  };
}

/** Common parameter fragments. */
const P = {
  project: {
    type: 'string',
    required: true,
    description: 'Project name; owns its ledger, audit journal and version files.',
  },
  id: { type: 'string', required: true, description: 'Stable element id used by later calls, e.g. "rear_wing_main".' },
  note: { type: 'string', description: 'One line recorded in the version history.' },
  version: { type: 'number', description: 'Version number; defaults to the newest usable version.' },
  count: { type: 'number', description: 'Points per surface when resampling a profile; 8-200, default 40.' },
  coordinates: {
    type: 'array',
    description: 'Profile coordinates as [x, y] pairs in any consistent unit; the chord is normalised automatically.',
    items: { type: 'array', items: { type: 'number' } },
  },
  naca: { type: 'string', description: 'NACA 4-digit code, e.g. "2412". Use this or coordinates, not both.' },
  chord: { type: 'number', description: 'Chord length in millimetres.' },
  aoaDeg: { type: 'number', description: 'Angle of attack in degrees; positive raises the leading edge.' },
  origin: {
    type: 'array',
    items: { type: 'number' },
    description: `Section origin [x, y, z], ${FRAME}.`,
  },
  pivot: {
    type: 'string',
    enum: ['le', 'quarterChord'],
    description: 'Which point of the profile sits at the origin: leading edge (default) or quarter chord.',
  },
  thicknessScale: { type: 'number', description: 'Scales profile thickness only; default 1.' },
};

const PROJECT_LEVEL = { readonly: LEVEL.READ, design: LEVEL.REFERENCE };

export function buildToolDefinitions(bridge, settings) {
  /** Default project for tools whose project argument is optional. */
  const projectOf = (args) => safeName(args?.project ?? SCRATCH_PROJECT, 'project');

  /**
   * Snapshot the ledger for rollback-on-failure. `null` is a real state — "this project had no
   * ledger yet" — so restoring it means removing the ledger rather than leaving a half-applied
   * change behind, which would leave a failed element blocking its id on the next attempt.
   */
  const snapshot = (project) => JSON.stringify(bridge.readLedger(project));
  const restore = (project, dump) => {
    if (dump === null || dump === undefined) return;
    const parsed = JSON.parse(dump);
    if (!parsed || typeof parsed !== 'object') {
      const paths = bridge.projectPaths(project, false);
      rmSync(paths.ledger, { force: true });
      return;
    }
    bridge.writeLedger(project, parsed);
  };

  /** Resolve the newest version entry whose file is actually on disk. */
  const latestUsable = (ledger) => {
    for (let i = ledger.versions.length - 1; i >= 0; i -= 1) {
      const entry = ledger.versions[i];
      if (entry.status !== 'unsaved' && entry.file && existsSync(path.join(bridge.projectPaths(ledger.project, false).dir, path.basename(entry.file)))) {
        return entry;
      }
    }
    return null;
  };

  const usableVersion = (ledger, version) => {
    if (version === undefined) return latestUsable(ledger);
    integerOption(version, 1, 1, 1000000, 'version');
    const entry = ledger.versions.find((v) => v.version === version);
    if (!entry || entry.status === 'unsaved' || !entry.file || !existsSync(path.join(bridge.projectPaths(ledger.project, false).dir, path.basename(entry.file)))) return null;
    return entry;
  };

  /**
   * Rebuild the whole ledger into a new numbered working copy.
   * @param project - project name.
   * @param options - `note`, `op`, `level`, and an already-mutated ledger.
   * @returns the tool result value.
   */
  async function buildVersion(project, options) {
    try { return await rebuildVersion(project, options); }
    catch (error) { return { status: 'FAILED', level: options.level ?? LEVEL.REFERENCE, project, errors: [error.message], detail: 'Rebuild did not complete; inspect the CATIA session if automation had started.' }; }
  }

  async function rebuildVersion(project, options) {
    const ledger = bridge.readLedger(project);
    if (!ledger) {
      return { status: 'BLOCKED', level: options.level ?? LEVEL.REFERENCE, project, errors: ['this project has no ledger yet'] };
    }
    const elements = orderedElements(ledger.elements);
    const next = Number(ledger.version ?? 0) + 1;
    const base = `${ledger.project}_GEN_${String(next).padStart(3, '0')}`;
    const paths = bridge.projectPaths(project, true);
    const target = bridge.freePath(paths.dir, base, '.CATPart');

    const body = [
      'AttachCatia',
      'NewDocument',
      ...elements.map((element) => elementFragment(element, elementContext(element, ledger.elements))),
      'If gFatal = "" Then',
      '  gKeepGeometry = True',
      '  Emit "geometryReady", "true"',
      'End If',
      `SaveAsChecked ${S(target)}`,
    ].join('\n');

    const outcome = await bridge.run({
      project,
      op: options.op ?? 'new_version',
      level: options.level ?? LEVEL.REFERENCE,
      title: `${ledger.project} ${base}`,
      body,
      auditArgs: { version: next, file: path.basename(target), note: options.note },
    });

    if (outcome.blocked) return { status: 'BLOCKED', level: options.level ?? LEVEL.REFERENCE, project, errors: outcome.errors };
    if (!outcome.ok && elements.length === 0) {
      return {
        status: 'FAILED',
        level: options.level ?? LEVEL.REFERENCE,
        project,
        version: ledger.version,
        detail: 'The build could not start.',
        errors: outcome.errors.length > 0 ? outcome.errors : ['no reason reported'],
      };
    }

    const built = elements
      .map((element) => outcome.values[`feature_${element.id}`])
      .filter((value) => typeof value === 'string' && value !== '');
    const saved = typeof outcome.values.saved === 'string' && outcome.values.saved !== '';
    const geometryComplete = built.length === elements.length && outcome.values.geometryReady === 'true' && outcome.values.rolledBack !== 'true' && !outcome.timedOut;
    const file = path.basename(target);

    if (outcome.ok || (geometryComplete && !saved)) {
      // Record the names CATIA actually gave the built features, so later scripts can bind to them
      // by name without assuming that renaming succeeded.
      for (const element of elements) {
        const actual = outcome.values[`feature_${element.id}`];
        if (typeof actual === 'string' && actual !== '') element.features = [actual];
      }
      ledger.version = next;
      ledger.versions.push({
        version: next,
        file: saved ? file : null,
        at: new Date().toISOString(),
        note: options.note ?? null,
        status: saved ? 'saved' : 'unsaved',
        elements: JSON.parse(JSON.stringify(ledger.elements)),
      });
      bridge.writeLedger(project, ledger);
    }

    if (outcome.ok && saved) {
      return {
        status: 'SUCCESS',
        level: options.level ?? LEVEL.REFERENCE,
        project,
        version: next,
        file,
        elements: elements.map((e) => e.id),
        detail: `${elements.length} element(s) rebuilt into ${file}.`,
        errors: outcome.errors,
        metrics: { seconds: (outcome.durationMs / 1000).toFixed(1) },
      };
    }
    if (geometryComplete && !saved) {
      return {
        status: 'PARTIAL_SUCCESS',
        level: options.level ?? LEVEL.REFERENCE,
        project,
        version: ledger.version,
        elements: elements.map((e) => e.id),
        detail: `Geometry for ${elements.length} element(s) built in CATIA, but the working copy could not be written to disk, so no version file exists.`,
        errors: outcome.errors,
        notes: [
          'The design is recorded in the ledger; run catia_env with checkWrite true to find out whether this CATIA instance is allowed to write files.',
        ],
      };
    }
    return {
      status: 'FAILED',
      level: options.level ?? LEVEL.REFERENCE,
      project,
      version: ledger.version,
      elements: elements.map((e) => e.id),
      detail: outcome.values.rolledBack === 'true' ? 'The model could not be built; rollback of newly created geometry was attempted.' : 'The model could not be built; inspect the CATIA session before retrying.',
      errors: outcome.errors.length > 0 ? outcome.errors : ['the build stopped without a reported reason'],
    };
  }

  /** Validate a set of new elements against the ledger before anything is written. */
  function validateNew(ledger, elements) {
    const merged = { ...ledger.elements };
    for (const element of elements) {
      if (merged[element.id] && !ledger.elements[element.id]) {
        throw new Error(`duplicate element id in this request: ${element.id}`);
      }
      if (ledger.elements[element.id]) throw new Error(`element id already exists: ${element.id}`);
      elementFragment(element, elementContext(element, merged));
      merged[element.id] = element;
    }
  }

  /**
   * Add elements to the ledger, then rebuild. Rolls the ledger back when the build fails.
   */
  async function addElements(project, elements, options) {
    const before = snapshot(project);
    if ((settings.maxLevel ?? 2) < LEVEL.REFERENCE) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['operation exceeds configured maxLevel'] };
    const ledger = bridge.readLedger(project) ?? { elements: {} };
    try {
      validateNew(ledger, elements);
    } catch (error) {
      return {
        status: 'BLOCKED',
        level: LEVEL.REFERENCE,
        project,
        errors: [error.message],
        detail: 'The request was rejected before anything was written.',
      };
    }
    bridge.withLedger(project, (current) => {
      for (const element of elements) current.elements[element.id] = element;
    });
    const result = await buildVersion(project, {
      note: options.note ?? `add ${elements.map((e) => e.id).join(', ')}`,
      op: options.op,
      level: LEVEL.REFERENCE,
    });
    if (['FAILED', 'BLOCKED'].includes(result.status)) restore(project, before);
    return result;
  }

  /** Emit the script that opens one version file. */
  const openVersion = (ledger, entry) => {
    const paths = bridge.projectPaths(ledger.project, false);
    return `UseDocument ${S(path.basename(entry.file))}, ${S(path.join(paths.dir, path.basename(entry.file)))}`;
  };

  const readTools = {
    catia_env: tool(
      'catia_env',
      'Report the CATIA automation session: whether CATIA answers, which documents are open, and whether this session can write files. Read-only (Level 0). Call it before the first modelling call and whenever a file operation fails.',
      {
        project: P.project,
        checkWrite: {
          type: 'boolean',
          description: 'Also prove file writing by saving a throwaway part and deleting it; answers whether a model can be persisted at all.',
        },
      },
      async (args) => {
        const project = projectOf(args);
        const body = [
          'AttachCatia',
          'Dim d, n',
          'n = 0',
          'For Each d In CATIA.Documents',
          '  Emit "openDoc", d.Name',
          '  n = n + 1',
          'Next',
          'Emit "openDocCount", n',
          args.checkWrite
            ? [
              'NewDocument',
              `SaveAsChecked ${S(bridge.freePath(bridge.projectPaths(project, true).exports, 'writecheck', '.CATPart'))}`,
            ].join('\n')
            : '',
        ].filter((line) => line !== '').join('\n');
        const outcome = await bridge.run({
          project,
          op: 'catia_env',
          level: LEVEL.READ,
          title: 'environment check',
          body,
          timeoutMs: 180000,
        });
        const docs = outcome.lists.openDoc ?? [];
        let writeNote = 'not tested';
        if (args.checkWrite) writeNote = outcome.values.saved ? `yes (${outcome.values.saved})` : 'no';
        const checkPath = outcome.values.saved;
        if (checkPath && existsSync(checkPath)) {
          try {
            rmSync(checkPath, { force: true });
          } catch {
            /* leaving the scratch file behind is harmless */
          }
        }
        return {
          status: outcome.ok ? 'SUCCESS' : 'FAILED',
          level: LEVEL.READ,
          project,
          metrics: {
            catia: outcome.ok ? 'reachable' : 'unreachable',
            canWriteFiles: writeNote,
            openDocuments: docs.length,
          },
          items: docs,
          detail: `Project root: ${bridge.root}`,
          errors: outcome.errors,
        };
      },
      { timeoutMs: 180000 },
    ),

    catia_tree: tool(
      'catia_tree',
      'List the geometrical sets and features present in one version file. Read-only (Level 0). Use it to confirm what a build actually produced before measuring or exporting.',
      { project: P.project, version: P.version },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no ledger for this project'] };
        const entry = usableVersion(ledger, args.version);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no version file on disk yet'] };
        const outcome = await bridge.run({
          project,
          op: 'catia_tree',
          level: LEVEL.READ,
          title: `tree ${entry.file}`,
          body: ['AttachCatia', openVersion(ledger, entry), 'DescribePart'].join('\n'),
          timeoutMs: 300000,
        });
        const shapes = outcome.lists.feature ?? [];
        const bodies = outcome.lists.body ?? [];
        return {
          status: outcome.ok ? 'SUCCESS' : 'FAILED',
          level: LEVEL.READ,
          project,
          version: entry.version,
          file: entry.file,
          items: [...bodies, ...shapes],
          metrics: { geometricalSets: bodies.length, features: shapes.length },
          errors: outcome.errors,
        };
      },
      { timeoutMs: 300000 },
    ),

    catia_read: tool(
      'catia_read',
      'Read the recorded design: every element, its parameters, and the resulting bounding box. Read-only (Level 0). Use it to answer questions about the current model without touching CATIA.',
      {
        project: P.project,
        id: { type: 'string', description: 'Restrict the answer to one element id.' },
        version: { type: 'number', description: 'Read the element set as it was at this version number.' },
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no ledger for this project'] };
        let elements = ledger.elements;
        if (args.version) {
          const entry = ledger.versions.find((v) => Number(v.version) === Number(args.version));
          if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: [`no version ${args.version}`] };
          elements = entry.elements;
        }
        const ids = args.id ? [String(args.id)] : Object.keys(elements);
        const items = [];
        const bounds = {};
        for (const id of ids) {
          const element = elements[id];
          if (!element) {
            items.push(`${id}: not found`);
            continue;
          }
          const box = elementBounds(element, elements);
          items.push(`${id} [${element.kind}] ${JSON.stringify(element.params)}`);
          if (box) bounds[id] = `${box.min.map((v) => v.toFixed(1)).join(',')} .. ${box.max.map((v) => v.toFixed(1)).join(',')}`;
        }
        return {
          status: 'SUCCESS',
          level: LEVEL.READ,
          project,
          version: args.version ?? ledger.version,
          items,
          metrics: bounds,
          detail: `Constraints: ${JSON.stringify(ledger.constraints ?? {})}`,
        };
      },
      { timeoutMs: 60000 },
    ),

    catia_audit: tool(
      'catia_audit',
      'Read the project audit journal and version history. Read-only (Level 0). Use it to reconstruct what was changed, when, and with which parameters.',
      {
        project: P.project,
        limit: { type: 'number', description: 'Maximum number of journal records, newest last; default 20, maximum 200.' },
      },
      async (args) => {
        const project = projectOf(args);
        const limit = Math.max(1, Math.min(200, Math.trunc(args.limit ?? 20)));
        const ledger = bridge.readLedger(project);
        const records = bridge.readAudit(project, limit);
        const versions = (ledger?.versions ?? []).map((v) => `v${v.version} ${v.file} (${v.status})${v.note ? ` - ${v.note}` : ''}`);
        return {
          status: 'SUCCESS',
          level: LEVEL.READ,
          project,
          items: [
            ...versions,
            ...records.map((r) => `${r.at} ${r.tool} ${r.status} level=${r.level} ${r.errors?.length ? `errors=${r.errors.length}` : ''}`),
          ],
          metrics: { versions: ledger?.versions?.length ?? 0, records: records.length },
        };
      },
      { timeoutMs: 60000 },
    ),

    catia_measure: tool(
      'catia_measure',
      'Measure the minimum distance between two built elements inside CATIA. Read-only (Level 0). Use it to check clearances and packaging before committing a change.',
      {
        project: P.project,
        from: { type: 'string', required: true, description: 'Element id (or CATIA feature name) to measure from.' },
        to: { type: 'string', required: true, description: 'Element id (or CATIA feature name) to measure to.' },
        version: P.version,
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no ledger for this project'] };
        const entry = usableVersion(ledger, args.version);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no version file on disk yet'] };
        const nameOf = (id) => {
          const element = (entry.elements ?? ledger.elements)[id];
          return element?.features?.[0] ?? String(id);
        };
        const a = nameOf(args.from);
        const b = nameOf(args.to);
        const outcome = await bridge.run({
          project,
          op: 'catia_measure',
          level: LEVEL.READ,
          title: `measure ${a} to ${b}`,
          body: [
            'AttachCatia',
            openVersion(ledger, entry),
            `BindFeature ${S(a)}`,
            `BindFeature ${S(b)}`,
            'MeasureDistance ' + [S(a), S(b), S('distance_mm')].join(', '),
          ].join('\n'),
          timeoutMs: 300000,
        });
        const value = outcome.values.distance_mm === undefined || outcome.values.distance_mm === '' ? NaN : Number(outcome.values.distance_mm);
        return {
          status: outcome.blocked ? 'BLOCKED' : !outcome.ok ? 'FAILED' : Number.isFinite(value) ? 'SUCCESS' : 'PARTIAL_SUCCESS',
          level: LEVEL.READ,
          project,
          version: entry.version,
          metrics: Number.isFinite(value) ? { distance_mm: value.toFixed(2) } : {},
          detail: Number.isFinite(value) ? `Minimum distance ${value.toFixed(2)} mm between ${args.from} and ${args.to}.` : undefined,
          errors: outcome.errors,
        };
      },
      { timeoutMs: 300000 },
    ),

    catia_check_rules: tool(
      'catia_check_rules',
      'Check parameter-derived aero geometry against caller-supplied geometric limits and forbidden boxes. Read-only (Level 0); rules passed in this call are not saved. Geometry is an approximation from the design ledger, not a CATIA whole-vehicle compliance certification.',
      {
        project: P.project,
        elementIds: { type: 'array', items: { type: 'string' }, description: 'Optional nonempty list of design element IDs to check; all are checked when omitted.' },
        rules: {
          type: 'object',
          description: 'Optional geometric limits in the plugin coordinate system (mm), with groundY (default 0): maxSpan/maxWidth (Z extent), maxLength (X extent), maxHeight (top Y from ground datum), minGroundClearance (lowest Y), minX/maxX/minY/maxY/minZ/maxZ, frontTireFrontX plus maxAheadOfFrontTire (default 700), rearTireRearX plus maxBehindRearTire (default 250), headrestBackX, maxHeightAheadOfHeadrest (default 500), maxHeightBehindHeadrest (default 1200), frontAxleX plus frontTireInnerZ for the T9.6 250 mm height zone, frontAxleX/rearAxleX plus frontTireOuterZ/rearTireOuterZ/rearTireInnerZ for T9.5 width-envelope screening, exclusionZones [{name,min:[x,y,z],max:[x,y,z]}], and heightZones [{name,min,max,maxHeight}]. Rules are checked for this call and are not stored.',
          additionalProperties: true,
        },
      },
      async (args) => checkGeometryRules(bridge.readLedger(projectOf(args)), args, projectOf(args)),
      { timeoutMs: 60000 },
    ),

    catia_check_clearance: tool(
      'catia_check_clearance',
      'Measure the real minimum distance for one or more element pairs inside CATIA and flag the pairs below a required clearance. Read-only (Level 0).',
      {
        project: P.project,
        pairs: {
          type: 'array',
          required: true,
          description: 'Pairs to measure as [{from, to}] using element ids.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              from: { type: 'string', required: true },
              to: { type: 'string', required: true },
            },
          },
        },
        minDistance: { type: 'number', description: 'Required clearance in millimetres; pairs below it are reported as conflicts.' },
        version: P.version,
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no ledger for this project'] };
        const threshold = args.minDistance === undefined ? null : args.minDistance;
        if (threshold !== null && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['minDistance must be a finite nonnegative number'] };
        const pairs = Array.isArray(args.pairs) ? args.pairs : [];
        if (pairs.some((pair) => !pair || typeof pair.from !== 'string' || typeof pair.to !== 'string' || !pair.from || !pair.to)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['pairs must contain from/to element names'] };
        if (pairs.length === 0) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['pairs must not be empty'] };
        if (pairs.length > 24) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['at most 24 pairs per call'] };
        const entry = usableVersion(ledger, args.version);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no version file on disk yet'] };
        const body = ['AttachCatia', openVersion(ledger, entry)];
        const nameOf = (id) => (entry.elements ?? ledger.elements)[id]?.features?.[0] ?? String(id);
        pairs.forEach((pair, index) => {
          body.push(`BindFeature ${S(nameOf(pair.from))}`);
          body.push(`BindFeature ${S(nameOf(pair.to))}`);
          body.push(`MeasureDistance ${S(nameOf(pair.from))}, ${S(nameOf(pair.to))}, ${S(`d${index}`)}`);
        });
        const outcome = await bridge.run({
          project,
          op: 'catia_check_clearance',
          level: LEVEL.READ,
          title: `clearance ${pairs.length} pair(s)`,
          body: body.join('\n'),
          timeoutMs: 600000,
        });
        const items = [];
        const violations = [];
        const missingMeasurements = [];
        pairs.forEach((pair, index) => {
          const value = Number(outcome.values[`d${index}`]);
          if (!Number.isFinite(value)) {
            missingMeasurements.push(index);
            items.push(`${pair.from} -> ${pair.to}: not measured`);
            return;
          }
          items.push(`${pair.from} -> ${pair.to}: ${value.toFixed(2)} mm`);
          if (Number.isFinite(threshold) && value < threshold) {
            violations.push(`${pair.from} -> ${pair.to} is ${value.toFixed(2)} mm, below the required ${threshold} mm`);
          }
        });
        return {
          status: outcome.blocked ? 'BLOCKED' : !outcome.ok ? 'FAILED' : violations.length > 0 || missingMeasurements.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          level: LEVEL.READ,
          project,
          version: entry.version,
          items,
          errors: [...violations, ...outcome.errors, ...(missingMeasurements.length ? ['some requested pairs were not measured'] : [])],
        };
      },
      { timeoutMs: 600000 },
    ),
  };

  const designTools = {
    catia_point: tool(
      'catia_point',
      'Add a reference point to the design. Modifies the design as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        x: { type: 'number', required: true, description: `X in ${FRAME}.` },
        y: { type: 'number', required: true, description: `Y in ${FRAME}.` },
        z: { type: 'number', required: true, description: `Z in ${FRAME}.` },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('point', safeName(args.id, 'id'), {
        x: args.x, y: args.y, z: args.z,
      }), { op: 'catia_point', note: args.note }),
    ),

    catia_line: tool(
      'catia_line',
      'Add a reference line between two points to the design, as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        from: { type: 'array', items: { type: 'number' }, required: true, description: `Start point [x, y, z], ${FRAME}.` },
        to: { type: 'array', items: { type: 'number' }, required: true, description: `End point [x, y, z], ${FRAME}.` },
        note: P.note,
      },
      async (args) => {
        const [x1, y1, z1] = args.from ?? [];
        const [x2, y2, z2] = args.to ?? [];
        return addElements(projectOf(args), expandRequest('line', safeName(args.id, 'id'), { x1, y1, z1, x2, y2, z2 }), { op: 'catia_line', note: args.note });
      },
    ),

    catia_plane: tool(
      'catia_plane',
      'Add a reference plane offset from a principal plane, as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        base: { type: 'string', required: true, enum: ['XY', 'YZ', 'ZX'], description: 'Principal plane the offset is measured from.' },
        offset: { type: 'number', required: true, description: 'Offset distance in millimetres.' },
        reverse: { type: 'boolean', description: 'Offset along the opposite normal.' },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('plane', safeName(args.id, 'id'), {
        base: args.base, offset: args.offset, reverse: args.reverse === true,
      }), { op: 'catia_plane', note: args.note }),
    ),

    catia_guide_curve: tool(
      'catia_guide_curve',
      'Add a free-form spline through explicit points, as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        points: {
          type: 'array',
          required: true,
          description: `At least two [x, y, z] points, ${FRAME}.`,
          items: { type: 'array', items: { type: 'number' } },
        },
        closed: { type: 'boolean', description: 'Close the spline back to its first point.' },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('guide_curve', safeName(args.id, 'id'), {
        points: args.points, closed: args.closed === true,
      }), { op: 'catia_guide_curve', note: args.note }),
    ),

    catia_airfoil: tool(
      'catia_airfoil',
      'Add a single closed airfoil section curve at a given position and angle, as a new version (Level 1, reversible). Use it for ribs, reference stations and single-element studies; use catia_wing to build a surface.',
      {
        project: P.project,
        id: P.id,
        naca: P.naca,
        coordinates: P.coordinates,
        count: P.count,
        chord: { ...P.chord, required: true },
        aoaDeg: P.aoaDeg,
        twistDeg: { type: 'number', description: 'Extra section rotation in degrees, added to aoaDeg.' },
        pivot: P.pivot,
        origin: P.origin,
        thicknessScale: P.thicknessScale,
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('section', safeName(args.id, 'id'), {
        naca: args.naca,
        coordinates: args.coordinates,
        count: args.count,
        chord: args.chord,
        aoaDeg: args.aoaDeg,
        twistDeg: args.twistDeg,
        pivot: args.pivot,
        origin: args.origin,
        thicknessScale: args.thicknessScale,
      }), { op: 'catia_airfoil', note: args.note }),
    ),

    catia_wing: tool(
      'catia_wing',
      'Add a lofted wing surface: airfoil profiles placed along the span and lofted into one surface, as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        naca: P.naca,
        coordinates: P.coordinates,
        count: P.count,
        span: { type: 'number', required: true, description: 'Spanwise extent in millimetres, from zStart to zStart + span.' },
        zStart: { type: 'number', description: 'Spanwise start position; default 0. Use -span/2 for a centred wing.' },
        chordRoot: { type: 'number', required: true, description: 'Chord at the root station in millimetres.' },
        chordTip: { type: 'number', description: 'Chord at the tip station; defaults to chordRoot (un-tapered).' },
        aoaRoot: { type: 'number', description: 'Angle of attack at the root in degrees; default 0.' },
        twist: { type: 'number', description: 'Tip angle of attack minus root angle of attack, in degrees; default 0 (washout is negative).' },
        sweepDeg: { type: 'number', description: 'Leading-edge sweep back in degrees; positive moves the leading edge aft with span.' },
        dihedralDeg: { type: 'number', description: 'Dihedral in degrees; positive raises the section origin with span.' },
        stations: { type: 'number', description: 'Number of spanwise sections to loft through, 2-24; default 5. More sections follow a curve more closely but cost build time.' },
        thicknessScale: P.thicknessScale,
        xOffset: { type: 'number', description: 'Extra chordwise offset of the root leading edge in millimetres.' },
        yOffset: { type: 'number', description: 'Extra vertical offset of the root section in millimetres.' },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('wing', safeName(args.id, 'id'), {
        naca: args.naca,
        coordinates: args.coordinates,
        count: args.count,
        span: args.span,
        zStart: args.zStart,
        chordRoot: args.chordRoot,
        chordTip: args.chordTip,
        aoaRoot: args.aoaRoot,
        twist: args.twist,
        sweepDeg: args.sweepDeg,
        dihedralDeg: args.dihedralDeg,
        stations: args.stations,
        thicknessScale: args.thicknessScale,
        xOffset: args.xOffset,
        yOffset: args.yOffset,
      }), { op: 'catia_wing', note: args.note }),
    ),

    catia_flap: tool(
      'catia_flap',
      'Add a flap element positioned relative to an existing wing or flap element, as a new version (Level 1, reversible). Gap and overlap are measured from the parent trailing edge: overlap moves the flap leading edge forward along the parent chord line, gap moves it down perpendicular to that line. A parent that is itself a flap builds a serial multi-element slot, with each stage measured against the stage ahead of it.',
      {
        project: P.project,
        id: P.id,
        parentId: { type: 'string', required: true, description: 'Id of the wing or flap element this flap follows; the flap inherits its spanwise stations, and gap/overlap are measured from that parent\'s trailing edge.' },
        naca: P.naca,
        coordinates: P.coordinates,
        count: P.count,
        chordRatio: { type: 'number', required: true, description: 'Flap chord as a fraction of the local parent chord.' },
        deflectionDeg: { type: 'number', description: 'Flap chord angle relative to the local parent chord line, in degrees; default 0.' },
        gap: { type: 'number', description: 'Perpendicular gap from the parent trailing edge in millimetres; default 2. Ignored when gapPercent is given.' },
        overlap: { type: 'number', description: 'Forward overlap past the parent trailing edge in millimetres; default 0. Ignored when overlapPercent is given.' },
        gapPercent: { type: 'number', description: `Gap as a percentage of the local parent chord; overrides gap.` },
        overlapPercent: { type: 'number', description: 'Overlap as a percentage of the local parent chord; overrides overlap.' },
        thicknessScale: P.thicknessScale,
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('flap', safeName(args.id, 'id'), {
        parentId: args.parentId,
        naca: args.naca,
        coordinates: args.coordinates,
        count: args.count,
        chordRatio: args.chordRatio,
        deflectionDeg: args.deflectionDeg,
        gap: args.gap,
        overlap: args.overlap,
        gapPercent: args.gapPercent,
        overlapPercent: args.overlapPercent,
        thicknessScale: args.thicknessScale,
      }), { op: 'catia_flap', note: args.note }),
    ),

    catia_multi_element_wing: tool(
      'catia_multi_element_wing',
      'Add a complete multi-element wing: one main wing plus serial flap elements, each anchored to the preceding stage, in a single version (Level 1, reversible). Use it for the common case of a main plane with one or two flaps rather than calling catia_wing and catia_flap repeatedly.',
      {
        project: P.project,
        id: P.id,
        naca: P.naca,
        coordinates: P.coordinates,
        count: P.count,
        span: { type: 'number', required: true, description: 'Spanwise extent in millimetres.' },
        zStart: { type: 'number', description: 'Spanwise start position; default 0.' },
        chordRoot: { type: 'number', required: true, description: 'Main wing chord at the root in millimetres.' },
        chordTip: { type: 'number', description: 'Main wing chord at the tip; defaults to chordRoot.' },
        aoaRoot: { type: 'number', description: 'Main wing root angle of attack in degrees.' },
        twist: { type: 'number', description: 'Tip minus root angle of attack in degrees.' },
        sweepDeg: { type: 'number', description: 'Leading-edge sweep back in degrees.' },
        dihedralDeg: { type: 'number', description: 'Dihedral in degrees.' },
        stations: { type: 'number', description: 'Spanwise sections to loft through; default 5.' },
        thicknessScale: P.thicknessScale,
        xOffset: { type: 'number', description: 'Chordwise offset of the root leading edge.' },
        yOffset: { type: 'number', description: 'Vertical offset of the root section.' },
        flaps: {
          type: 'array',
          description: 'Flap elements in flow order, each with chordRatio, deflectionDeg and gap/overlap (or gapPercent/overlapPercent); each may override naca/coordinates.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              chordRatio: { type: 'number', required: true, description: 'Flap chord as a fraction of the local parent chord.' },
              deflectionDeg: { type: 'number', description: 'Angle relative to the local parent chord line, in degrees.' },
              gap: { type: 'number', description: 'Perpendicular gap from the parent trailing edge in millimetres.' },
              overlap: { type: 'number', description: 'Forward overlap past the parent trailing edge in millimetres.' },
              gapPercent: { type: 'number', description: 'Gap as a percentage of the local parent chord.' },
              overlapPercent: { type: 'number', description: 'Overlap as a percentage of the local parent chord.' },
              naca: { type: 'string', description: 'Profile override for this flap.' },
              coordinates: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Profile coordinate override for this flap.' },
              thicknessScale: { type: 'number', description: 'Thickness scale override for this flap.' },
            },
          },
        },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('multi_element_wing', safeName(args.id, 'id'), {
        naca: args.naca,
        coordinates: args.coordinates,
        count: args.count,
        span: args.span,
        zStart: args.zStart,
        chordRoot: args.chordRoot,
        chordTip: args.chordTip,
        aoaRoot: args.aoaRoot,
        twist: args.twist,
        sweepDeg: args.sweepDeg,
        dihedralDeg: args.dihedralDeg,
        stations: args.stations,
        thicknessScale: args.thicknessScale,
        xOffset: args.xOffset,
        yOffset: args.yOffset,
        flaps: args.flaps,
      }), { op: 'catia_multi_element_wing', note: args.note }),
    ),

    catia_endplate: tool(
      'catia_endplate',
      'Add a flat endplate as a thin lofted slab, as a new version (Level 1, reversible). Either give a chord/height outline or an explicit outline.',
      {
        project: P.project,
        id: P.id,
        z: { type: 'number', required: true, description: `Spanwise position of the plate's near face in ${FRAME}.` },
        thickness: { type: 'number', description: 'Plate thickness in millimetres; default 2.' },
        chord: { type: 'number', description: 'Outline length along X in millimetres; default 300. Ignored when outlinePoints is given.' },
        height: { type: 'number', description: 'Outline height along Y in millimetres; default 120. Ignored when outlinePoints is given.' },
        sweepDeg: { type: 'number', description: 'Angle in degrees at which the outline trailing edge leans back.' },
        outlinePoints: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
          description: 'Explicit closed outline as [x, y] pairs in the XY plane; overrides chord and height.',
        },
        scale: { type: 'number', description: 'Uniform outline scale; default 1.' },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('endplate', safeName(args.id, 'id'), {
        z: args.z,
        thickness: args.thickness,
        chord: args.chord,
        height: args.height,
        sweepDeg: args.sweepDeg,
        outlinePoints: args.outlinePoints,
        scale: args.scale,
      }), { op: 'catia_endplate', note: args.note }),
    ),

    catia_diffuser: tool(
      'catia_diffuser',
      'Add a diffuser: a box-like surface lofted from inlet to outlet, as a new version (Level 1, reversible).',
      {
        project: P.project,
        id: P.id,
        inlet: {
          type: 'object',
          required: true,
          description: 'Inlet cross-section: height, halfWidth, and optional y (vertical position of the floor).',
          additionalProperties: true,
        },
        outlet: {
          type: 'object',
          required: true,
          description: 'Outlet cross-section: height, halfWidth, and optional y.',
          additionalProperties: true,
        },
        length: { type: 'number', required: true, description: 'Streamwise length in millimetres.' },
        xStart: { type: 'number', description: 'X position of the inlet; default 0.' },
        stations: { type: 'number', description: 'Cross-sections to loft through, 2-12; default 3.' },
        note: P.note,
      },
      async (args) => addElements(projectOf(args), expandRequest('diffuser', safeName(args.id, 'id'), {
        inlet: args.inlet,
        outlet: args.outlet,
        length: args.length,
        xStart: args.xStart,
        stations: args.stations,
      }), { op: 'catia_diffuser', note: args.note }),
    ),

    catia_new_version: tool(
      'catia_new_version',
      'Rebuild every recorded element into the next numbered working copy. Use it to re-issue the current design, for example after the user confirms the parameters (Level 1, reversible; existing files are never overwritten).',
      { project: P.project, note: P.note },
      async (args) => {
        const project = projectOf(args);
        if (!bridge.readLedger(project)) {
          return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['no ledger for this project yet'] };
        }
        return buildVersion(project, { note: args.note ?? 'explicit rebuild', op: 'catia_new_version', level: LEVEL.REFERENCE });
      },
    ),

    catia_set_aero_param: tool(
      'catia_set_aero_param',
      'Change whitelisted aerodynamic parameters of an existing element and rebuild the design as a new version (Level 2). Only the keys listed for the element kind are accepted, and a reason is mandatory: the previous and new values are recorded in the audit journal, and the previous versions stay on disk so the change can be reverted. Never adjust a design parameter the user has not authorised.',
      {
        project: P.project,
        id: { type: 'string', required: true, description: 'Element to change.' },
        params: {
          type: 'object',
          required: true,
          description: 'Whitelisted parameters to change, e.g. {"deflectionDeg": 25} for a flap or {"chordTip": 180} for a wing.',
          additionalProperties: true,
        },
        reason: { type: 'string', required: true, description: 'Why this change is being made; recorded verbatim in the audit journal.' },
        note: P.note,
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.MODIFY, project, errors: ['no ledger for this project'] };
        const element = ledger.elements[args.id];
        if (!element) return { status: 'BLOCKED', level: LEVEL.MODIFY, project, errors: [`no element ${args.id}`] };
        if ((settings.maxLevel ?? 2) < LEVEL.MODIFY) return { status: 'BLOCKED', level: LEVEL.MODIFY, project, errors: ['operation exceeds configured maxLevel'] };
        if (typeof args.reason !== 'string' || args.reason.trim() === '' || !args.params || Array.isArray(args.params) || typeof args.params !== 'object' || Object.keys(args.params).length === 0) return { status: 'BLOCKED', level: LEVEL.MODIFY, project, errors: ['a reason and a nonempty parameter object are required'] };
        const allowed = EDITABLE[element.kind] ?? [];
        const requested = Object.keys(args.params ?? {});
        const rejected = requested.filter((key) => !allowed.includes(key));
        if (rejected.length > 0) {
          return {
            status: 'BLOCKED',
            level: LEVEL.MODIFY,
            project,
            errors: [`${element.kind} does not accept: ${rejected.join(', ')}`, `editable keys: ${allowed.join(', ')}`],
          };
        }
        const before = JSON.stringify(element.params);
        const candidate = { ...element, params: { ...element.params, ...args.params } };
        try {
          const probe = { ...ledger.elements, [candidate.id]: candidate };
          for (const dependent of orderedElements(probe)) elementFragment(dependent, elementContext(dependent, probe));
        } catch (error) {
          return { status: 'BLOCKED', level: LEVEL.MODIFY, project, errors: [`rejected parameters: ${error.message}`] };
        }
        const dump = snapshot(project);
        bridge.withLedger(project, (current) => {
          current.elements[candidate.id] = candidate;
        });
        bridge.audit(project, {
          tool: 'catia_set_aero_param',
          level: LEVEL.MODIFY,
          status: 'applied',
          reason: args.reason,
          elementId: candidate.id,
          before: JSON.parse(before),
          after: candidate.params,
        });
        const result = await buildVersion(project, {
          note: args.note ?? `change ${candidate.id}: ${requested.join(', ')}`,
          op: 'catia_set_aero_param',
          level: LEVEL.MODIFY,
        });
        if (['FAILED', 'BLOCKED'].includes(result.status)) restore(project, dump);
        return {
          ...result,
          detail: `${result.detail ?? ''} Changed ${requested.join(', ')} on ${candidate.id}. Reason: ${args.reason}`.trim(),
        };
      },
    ),

    catia_rollback: tool(
      'catia_rollback',
      'Restore the element parameters recorded at an earlier version and rebuild them into a new working copy (Level 1, reversible; no file is deleted). Use it when a change turns out to be wrong.',
      {
        project: P.project,
        version: { type: 'number', required: true, description: 'Version number whose element set should become current again.' },
        note: P.note,
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['no ledger for this project'] };
        const entry = ledger.versions.find((v) => Number(v.version) === Number(args.version));
        if (!entry) {
          return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: [`no version ${args.version}`, `known versions: ${ledger.versions.map((v) => v.version).join(', ')}`] };
        }
        const dump = snapshot(project);
        bridge.withLedger(project, (current) => {
          current.elements = JSON.parse(JSON.stringify(entry.elements));
        });
        const result = await buildVersion(project, {
          note: args.note ?? `rollback to version ${entry.version}`,
          op: 'catia_rollback',
          level: LEVEL.REFERENCE,
        });
        if (['FAILED', 'BLOCKED'].includes(result.status)) restore(project, dump);
        return result;
      },
    ),

    catia_export: tool(
      'catia_export',
      'Export a version to STEP or STL. Writes a new file and never overwrites an existing one (Level 1). STL needs a closed volume, so surface models may legitimately fail; report that rather than treating it as a modelling error.',
      {
        project: P.project,
        version: P.version,
        format: { type: 'string', required: true, enum: ['step', 'stl'], description: 'Export format.' },
        name: { type: 'string', description: 'Base file name without extension; defaults to the version file name.' },
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['no ledger for this project'] };
        const entry = usableVersion(ledger, args.version);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['no version file on disk yet'] };
        const paths = bridge.projectPaths(project, true);
        const base = safeName(args.name ?? path.basename(entry.file, path.extname(entry.file)), 'name');
        const ext = args.format === 'stl' ? '.stl' : '.stp';
        const target = bridge.freePath(paths.exports, base, ext);
        const outcome = await bridge.run({
          project,
          op: 'catia_export',
          level: LEVEL.REFERENCE,
          title: `export ${args.format}`,
          body: [
            'AttachCatia',
            openVersion(ledger, entry),
            `ExportChecked ${S(target)}, ${S(args.format === 'stl' ? 'stl' : 'stp')}`,
          ].join('\n'),
          auditArgs: { format: args.format, target },
          timeoutMs: 600000,
        });
        const written = typeof outcome.values.exported === 'string' ? outcome.values.exported : null;
        return {
          status: outcome.ok && written ? 'SUCCESS' : 'FAILED',
          level: LEVEL.REFERENCE,
          project,
          version: entry.version,
          file: written ? path.basename(written) : undefined,
          detail: written ? `Exported ${written}` : `Export of version ${entry.version} to ${args.format} did not produce a file.`,
          errors: outcome.errors,
        };
      },
      { timeoutMs: 600000 },
    ),
  };

  function assemblyWriteTool(mode) {
    const level = mode === 'insert' ? LEVEL.REFERENCE : LEVEL.DESTRUCTIVE;
    const name = 'catia_assembly_' + mode;
    return tool(name,
      mode === 'insert'
        ? 'Insert one new component into a CATProduct (Level 1), explicitly setting its rigid placement. Default is identity in CATIA axis-column order. Optional saveAs writes a new CATProduct; referenced files are not copied.'
        : 'Modify one uniquely named instance (Level 3), with confirm repeating component and a reason. componentPath selects nested parents by exact name. Replacement inserts the new file and sets the old local placement before removing the old instance; constraints and publications still need manual review. Optional saveAs writes a new CATProduct; referenced files are not copied.',
      {
        project: P.project,
        product: { type: 'string', required: true, description: 'Absolute .CATProduct path.' },
        component: { type: 'string', required: true, description: mode === 'insert' ? 'Absolute .CATPart or .CATProduct path.' : 'Exact instance name to modify, matching the final componentPath entry.' },
        ...(mode === 'insert' ? {
          placement: { type: 'array', items: { type: 'number' }, description: 'CATIA Position: X-axis xyz, Y-axis xyz, Z-axis xyz, origin xyz (mm). Must be a proper rigid transform; default identity.' },
        } : {
          componentPath: { type: 'array', items: { type: 'string' }, description: 'Optional root-relative list of instance names, e.g. ["RearAssembly.1", "Wing.1"]. Each level must match exactly one instance.' },
          confirm: { type: 'string', required: true, description: 'Repeat component exactly.' },
          reason: { type: 'string', required: true, description: 'Reason for this modification, recorded in the audit journal.' },
        }),
        ...(mode === 'replace' ? { withFile: { type: 'string', required: true, description: 'Absolute replacement .CATPart or .CATProduct path.' } } : {}),
        ...(mode !== 'remove' ? { instanceName: { type: 'string', description: 'Optional new instance name.' } } : {}),
        saveAs: { type: 'string', description: 'Optional absolute path of a new .CATProduct; existing files refused. Its external references remain linked to their source files.' },
      },
      async (args) => {
        const project = projectOf(args);
        if (level > (settings.maxLevel ?? bridge.settings?.maxLevel ?? 2)) return { status: 'BLOCKED', level, project, errors: ['operation exceeds configured maxLevel'] };
        let input;
        try { input = assemblyInputs(args, mode); } catch (error) { return { status: 'BLOCKED', level, project, errors: [error.message] }; }
        const outcome = await bridge.run({ project, op: name, level, title: mode + ' assembly component', body: assemblyMutationBody(input, mode), auditArgs: input });
        const values = outcome.values ?? {};
        const complete = mode === 'insert' ? Number(values.added) === 1 && values.placementVerified === 'true' : mode === 'remove' ? Number(values.removed) === 1 : Number(values.removed) === 1 && Number(values.inserted) === 1 && values.placementVerified === 'true';
        const modified = values.sessionModified === 'true' || Number(values.inserted) === 1 || Number(values.removed) === 1;
        return {
          status: outcome.blocked ? 'BLOCKED' : outcome.ok && complete ? 'SUCCESS' : modified ? 'PARTIAL_SUCCESS' : 'FAILED',
          level, project, file: values.savedAs || input.product,
          sessionModified: modified,
          saved: Boolean(values.savedAs),
          placementVerified: values.placementVerified === 'true',
          detail: outcome.ok && complete ? mode + ' completed. ' + (values.savedAs ? 'Assembly saved to a new CATProduct.' : 'The change is in the CATIA session; no assembly file was saved.') : 'Operation did not fully complete. ' + (modified ? 'Inspect the active assembly before retrying; it may contain changes.' : 'No completed modification was reported.'),
          errors: outcome.errors ?? (outcome.message ? [outcome.message] : []), values,
          notes: ['CATProduct references are not a self-contained delivery. Keep the referenced CATPart/CATProduct files available or use CATIA Save Management.', ...(mode === 'replace' ? ['Replacement preserves the old local transform. Review constraints, publications and references after replacement.'] : [])],
        };
      }, { timeoutMs: 900000 });
  }

  const assemblyTools = {
    step_assembly_components: tool(
      'step_assembly_components',
      'Read STEP assembly structure and placement without CATIA. Optional includeBounds returns approximate component envelopes and per-component quality flags; these cannot certify clearance or rule compliance. Coordinates use the source file units (no automatic unit conversion; mm assumed by thresholds). CSV export writes a new file in the project when enabled.',
      {
        project: P.project,
        file: { type: 'string', required: true, description: 'Absolute path of the .stp/.step file to read. It is only read, never modified.' },
        maxInstances: { type: 'number', description: 'Cap on returned component instances; default 20000.' },
        includeBounds: { type: 'boolean', description: 'Opt in to approximate envelopes; default false. Inspect boundsStatus, boundsWarnings and boundsUsableForCompliance.' },
        maxEnvelopeBytes: { type: 'number', description: 'Typed-array allocation budget for envelopes; default 536870912 bytes, maximum 2147483648. Not a whole-process memory limit.' },
        exportCsv: { type: 'boolean', description: 'Also write the full table into <project>/exports as CSV; default true. An existing file is never overwritten.' },
      },
      async (args) => {
        const project = projectOf(args);
        const file = String(args.file ?? '');
        if (!path.isAbsolute(file)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['file must be an absolute path'] };
        if (!existsSync(file)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: [`no such file: ${file}`] };
        if (!/\.(stp|step)$/i.test(file)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['file must be a .stp or .step file'] };
        if (args.maxInstances !== undefined && (!Number.isSafeInteger(args.maxInstances) || args.maxInstances < 1 || args.maxInstances > 50000)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['maxInstances must be an integer in 1..50000'] };
        if (args.includeBounds !== undefined && typeof args.includeBounds !== 'boolean') return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['includeBounds must be a boolean'] };
        if (args.maxEnvelopeBytes !== undefined && (!Number.isSafeInteger(args.maxEnvelopeBytes) || args.maxEnvelopeBytes < 16777216 || args.maxEnvelopeBytes > 2147483648)) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['maxEnvelopeBytes must be an integer in 16777216..2147483648'] };
        const maxInstances = args.maxInstances ?? 20000;
        const includeBounds = args.includeBounds === true;
        let result;
        try {
          result = await readStepAssembly(file, { includeBounds, maxInstances, maxEnvelopeBytes: args.maxEnvelopeBytes });
        } catch (error) {
          return { status: 'BLOCKED', level: LEVEL.READ, project, errors: [`STEP read failed: ${error.message}`] };
        }
        const rows = result.instances;
        const items = rows.slice(0, 80).map((row) => {
          const origin = row.origin ? (row.origin ?? [null, null, null]).map((v) => v.toFixed(1)).join(', ') : 'unresolved';
          const bounds = includeBounds ? `  bounds=${row.boundsStatus ?? 'unavailable'}${row.bounds ? ` [${row.bounds.min.join(',')}]..[${row.bounds.max.join(',')}]` : ''} warnings=${(row.boundsWarnings ?? []).join(';')}` : '';
          return `d${row.depth} ${row.path}  origin ${origin}  part=${row.partNumber ?? '?'}${bounds}`;
        });
        let csvFile = null;
        if (args.exportCsv !== false && rows.length > 0) {
          const paths = bridge.projectPaths(project, true);
          const base = safeName(`${path.basename(file, path.extname(file))}-components`, 'name');
          csvFile = bridge.freePath(paths.exports, base, '.csv');
          const header = 'path,name,partNumber,depth,originX,originY,originZ,m00,m01,m02,tx,m10,m11,m12,ty,m20,m21,m22,tz'
            + (includeBounds ? ',minX,minY,minZ,maxX,maxY,maxZ,boundsStatus,boundsWarnings,boundsUsableForCompliance' : '');
          const quote = (value) => {
            const clean = String(value ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ');
            const safe = /^\s*[=+\-@]/.test(clean) ? `'${clean}` : clean;
            return `"${safe.replace(/"/g, '""')}"`;
          };
          const q = (v) => (Number.isFinite(v) ? v.toFixed(4) : '');
          const body = rows.map((row) => {
            const m = row.matrix ?? new Array(12).fill(NaN);
            return [
              quote(row.path), quote(row.name), quote(row.partNumber), row.depth,
              row.origin ? q(row.origin[0]) : '', row.origin ? q(row.origin[1]) : '', row.origin ? q(row.origin[2]) : '',
              q(m[0]), q(m[1]), q(m[2]), q(m[3]), q(m[4]), q(m[5]), q(m[6]), q(m[7]), q(m[8]), q(m[9]), q(m[10]), q(m[11]),
              ...(includeBounds ? [
                ...[0, 1, 2].map((axis) => q(row.bounds?.min[axis])),
                ...[0, 1, 2].map((axis) => q(row.bounds?.max[axis])),
                quote(row.boundsStatus ?? 'unavailable'), quote((row.boundsWarnings ?? []).join(';')), 'false',
              ] : []),
            ].join(',');
          }).join('\n');
          writeFileSync(csvFile, `${header}\n${body}\n`, 'utf8');
        }
        const stats = result.stats;
        return {
          status: stats.instances === 0 ? 'FAILED' : stats.unresolvedPlacements > 0 || stats.representationMismatches > 0 || stats.truncated || (includeBounds && (stats.boundsSuspect > 0 || stats.boundsWithoutGeometry > 0)) ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          level: LEVEL.READ,
          project,
          file: csvFile ? path.basename(csvFile) : undefined,
          items,
          components: rows.slice(0, 80),
          returnedComponents: Math.min(rows.length, 80),
          componentPreviewTruncated: rows.length > 80,
          detail: `Read ${stats.instances} component instance(s), depth up to ${stats.maxDepth}, from ${path.basename(file)}: ${stats.placementsAssigned} placement(s) resolved, ${stats.unresolvedPlacements} unresolved.`,
          metrics: {
            fileSize_MB: (stats.fileBytes / 1048576).toFixed(1),
            products: stats.products,
            usageOccurrences: stats.usageOccurrences,
            placementsResolved: stats.placementsAssigned,
            placementCrosscheckMatches: stats.representationMatches,
            placementCrosscheckMismatches: stats.representationMismatches,
            instances: stats.instances,
            maxDepth: stats.maxDepth,
            componentExtents: includeBounds ? stats.boundsValidation : 'not requested',
            units: stats.units,
            ...(includeBounds ? { boundsFromGeometry: stats.boundsFromGeometry, boundsWithoutGeometry: stats.boundsWithoutGeometry, boundsSuspect: stats.boundsSuspect, boundsIncomplete: stats.boundsIncomplete, envelopeMemoryMB: stats.envelopeMemoryMB, boundsUsableForCompliance: false } : {}),
          },
          errors: [
            ...(stats.representationMismatches > 0 ? [`${stats.representationMismatches} placement(s) failed the child-shape cross-check and may be wrong`] : []),
            ...(stats.unresolvedPlacements > 0 ? [`${stats.unresolvedPlacements} instance(s) have no resolved placement`] : []),
            ...(stats.truncated ? ['the instance list was truncated by maxInstances'] : []),
            ...(includeBounds && stats.boundsSuspect > 0 ? [`${stats.boundsSuspect} component envelope(s) are suspect or incomplete; inspect component flags`] : []),
            ...(includeBounds && stats.boundsWithoutGeometry > 0 ? [`${stats.boundsWithoutGeometry} component(s) have no own envelope`] : []),
          ],
          notes: [
            ...(csvFile ? [`component table: ${csvFile}`] : []),
            ...(includeBounds ? ['Approximate source-coordinate envelopes only; do not infer collision-free space or rule compliance. Missing geometry also makes subtree unions incomplete.'] : []),
            ...(rows.length > 80 ? ['The tool preview contains 80 components; use exportCsv for the full retained table.'] : []),
          ],
        };
      },
      { timeoutMs: 900000 },
    ),

    catia_open_document: tool(
      'catia_open_document',
      'Open a document in the running CATIA session by absolute path (Level 1). Call it before reading an assembly with catia_assembly_positions. Importing a large STEP blocks the CATIA session until it completes, so expect a slow call; the path is recorded verbatim in the audit journal.',
      {
        project: P.project,
        path: { type: 'string', required: true, description: 'Absolute path of the file to open (.CATProduct, .CATPart, .stp, .step, .igs, .model, .cgr).' },
      },
      async (args) => {
        const project = projectOf(args);
        const target = String(args.path ?? '');
        if (!path.isAbsolute(target) || /[\u0000-\u001f]/.test(target)) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['path must be an absolute file path without control characters'] };
        if (!existsSync(target)) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: [`no such file: ${target}`] };
        if (!/\.(CATProduct|CATPart|stp|step|igs|iges|model|cgr)$/i.test(target)) {
          return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['unsupported file type; expected a CATIA part/product or a STEP/IGES model'] };
        }
        const body = [
          'AttachCatia',
          'Dim openedDoc',
          `Set openedDoc = CATIA.Documents.Open(${S(target)})`,
          'If Err.Number <> 0 Then',
          '  Fail "Documents.Open failed :: " & Err.Number & " :: " & Err.Description',
          'Else',
          '  Emit "opened", openedDoc.Name',
          '  Emit "docType", TypeName(openedDoc)',
          '  Emit "documentPath", openedDoc.FullName',
          'End If',
        ].join('\n');
        const outcome = await bridge.run({
          project,
          op: 'catia_open_document',
          level: LEVEL.REFERENCE,
          title: `open ${path.basename(target)}`,
          body,
          auditArgs: { path: target },
        });
        const opened = outcome.values.opened;
        const docType = outcome.values.docType ?? '';
        const kind = /Product/i.test(docType) ? 'assembly (product)' : /Part/i.test(docType) ? 'part' : docType || 'unknown';
        return {
          status: outcome.ok && opened ? 'SUCCESS' : 'FAILED',
          level: LEVEL.REFERENCE,
          project,
          file: opened,
          detail: opened
            ? `Opened ${opened} as ${kind}.${/assembly/.test(kind) ? ' Read component positions with catia_assembly_positions.' : ' It is not an assembly, so there is no component tree to read.'}`
            : `CATIA did not open ${path.basename(target)}.`,
          errors: outcome.errors,
        };
      },
    ),

    catia_assembly_insert: assemblyWriteTool('insert'),
    catia_assembly_remove: assemblyWriteTool('remove'),
    catia_assembly_replace: assemblyWriteTool('replace'),

    catia_assembly_positions: tool(
      'catia_assembly_positions',
      'Walk the active CATIA product tree and report absolute placements in the assembly frame (Level 0, read-only). Compose nested instance transformations and report truncation or missing positions. This tool does not measure geometric extents; use catia_measure for selected measurements. STEP envelopes are approximate and cannot certify clearance or compliance.',
      {
        project: P.project,
        maxComponents: { type: 'number', description: 'Cap on reported components; default 500.' },
        maxDepth: { type: 'number', description: 'Cap on assembly depth to walk; default 12.' },
      },
      async (args) => {
        const project = projectOf(args);
        const maxComponents = integerOption(args.maxComponents, 500, 1, 20000, 'maxComponents');
        const maxDepth = integerOption(args.maxDepth, 12, 1, 40, 'maxDepth');
        const body = [
          'AttachCatia',
          'Dim asmDoc, asmRoot, asmEmitted, asmTruncated, asmIdent(11)',
          'asmTruncated = False',
          'asmEmitted = 0',
          'asmIdent(0) = 1 : asmIdent(1) = 0 : asmIdent(2) = 0 : asmIdent(3) = 0',
          'asmIdent(4) = 0 : asmIdent(5) = 1 : asmIdent(6) = 0 : asmIdent(7) = 0',
          'asmIdent(8) = 0 : asmIdent(9) = 0 : asmIdent(10) = 1 : asmIdent(11) = 0',
          'Set asmDoc = CATIA.ActiveDocument',
          'Emit "document", asmDoc.Name',
          'Set asmRoot = asmDoc.Product',
          'If asmRoot Is Nothing Then',
          '  Fail "the active document has no Product, so it is a part with no component tree"',
          'Else',
          '  Emit "root", asmRoot.Name',
          '  Emit "rootChildren", asmRoot.Products.Count',
          `  AsmWalk asmRoot, AsmText(asmRoot.Name), 1, asmIdent, True, ${maxDepth}, ${maxComponents}`,
          '  Emit "walked", asmEmitted',
          '  Emit "truncated", LCase(CStr(asmTruncated))',
          'End If',
          '',
          SUB_ASM_MATMUL,
          SUB_ASM_WALK,
        ].join('\n');
        const outcome = await bridge.run({
          project,
          op: 'catia_assembly_positions',
          level: LEVEL.READ,
          title: 'assembly positions',
          body,
          timeoutMs: 900000,
        });
        const parseErrors = [];
        const rows = (outcome.lists?.component ?? []).map((line) => {
          try { return parseAssemblyRow(line); } catch (error) { parseErrors.push(error.message); return null; }
        }).filter(Boolean);
        const root = outcome.values.root;
        if (rows.length === 0) {
          return {
            status: outcome.ok ? 'PARTIAL_SUCCESS' : 'FAILED',
            level: LEVEL.READ,
            project,
            detail: 'The active document yielded no assembly components.',
            errors: outcome.errors.length > 0 ? outcome.errors : ['the active document has no Product, or the product tree is empty'],
          };
        }
        const walked = Number(outcome.values.walked ?? rows.length);
        const items = rows.slice(0, 80).map((row) => {
          const origin = row.origin.map((v) => (Number.isFinite(v) ? v.toFixed(1) : '?')).join(', ');
          return `d${row.depth} ${row.path}  origin ${origin}  part=${row.partNumber}`;
        });
        const placementErrors = outcome.lists?.placementError ?? [];
        const truncated = outcome.values.truncated === 'true';
        return {
          status: !outcome.ok ? 'FAILED' : placementErrors.length > 0 || parseErrors.length > 0 || truncated ? 'PARTIAL_SUCCESS' : 'SUCCESS',
          level: LEVEL.READ,
          project,
          file: outcome.values.document,
          items,
          detail: `${rows.length} component(s) from ${outcome.values.document ?? 'the active document'}; root "${root ?? '?'}" has ${outcome.values.rootChildren ?? '?'} direct children.`,
          components: rows.slice(0, 80),
          returnedComponents: Math.min(rows.length, 80),
          componentPreviewTruncated: rows.length > 80,
          metrics: { components: rows.length, root: root ?? '?', depthCap: maxDepth, truncated, matrixConvention: 'row-major 3x4; translations at 3,7,11' },
          errors: [
            ...placementErrors.slice(0, 5).map((entry) => `no placement read for ${entry}`),
            ...outcome.errors, ...parseErrors,
            ...(truncated ? ['the walk omitted components at a depth or count cap'] : []),
          ],
          notes: ['Origins are in the assembly frame, composed down the tree. Geometric extents are unavailable through this CATIA build automation.'],
        };
      },
      { timeoutMs: 900000 },
    ),
  };

  return [...Object.values(readTools), ...Object.values(designTools), ...Object.values(assemblyTools)];
}

/** Matrix multiply for the assembly walk: rows 0..2, columns 0..3, translation in column 3. */
const SUB_ASM_MATMUL = [
  'Sub AsmMatMul(parent, local, world)',
  '  Dim r, c, k, s',
  '  For r = 0 To 2',
  '    For c = 0 To 3',
  '      s = 0',
  '      For k = 0 To 2',
  '        s = s + parent(r * 4 + k) * local(k * 4 + c)',
  '      Next',
  '      If c = 3 Then s = s + parent(r * 4 + 3)',
  '      world(r * 4 + c) = s',
  '    Next',
  '  Next',
  'End Sub',
].join('\n');

/** Depth-first walk of the product tree, composing each instance placement into the parent frame. */
const SUB_ASM_WALK = [
  'Function AsmText(v)',
  '  AsmText = Replace(Replace(Replace(Replace(CStr(v), "|", "/"), vbTab, " "), vbCr, " "), vbLf, " ")',
  'End Function',
  'Function AsmNumber(v)',
  '  AsmNumber = Replace(CStr(v), ",", ".")',
  'End Function',
  'Sub AsmWalk(p, basePath, depth, parent, parentValid, depthCap, limit)',
  '  Dim kids, i, k, child, a(11), local(11), world(11), nm, pn, joined, valid, numbers, status',
  '  On Error Resume Next',
  '  Set kids = p.Products',
  '  If Err.Number <> 0 Then',
  '    Emit "placementError", basePath & " (children unavailable)"',
  '    Err.Clear',
  '    Exit Sub',
  '  End If',
  '  If depth > depthCap Then',
  '    If kids.Count > 0 Then asmTruncated = True',
  '    Exit Sub',
  '  End If',
  '  For i = 1 To kids.Count',
  '    If asmEmitted >= limit Then',
  '      asmTruncated = True',
  '      Exit Sub',
  '    End If',
  '    Set child = kids.Item(i)',
  '    nm = AsmText(child.Name)',
  '    pn = AsmText(child.PartNumber)',
  '    joined = basePath & "/" & nm',
  '    Err.Clear',
  '    child.Position.GetComponents a',
  '    valid = parentValid And (Err.Number = 0)',
  '    Err.Clear',
  '    If valid Then',
  '      local(0) = a(0) : local(1) = a(3) : local(2) = a(6) : local(3) = a(9)',
  '      local(4) = a(1) : local(5) = a(4) : local(6) = a(7) : local(7) = a(10)',
  '      local(8) = a(2) : local(9) = a(5) : local(10) = a(8) : local(11) = a(11)',
  '      AsmMatMul parent, local, world',
  '      numbers = ""',
  '      For k = 0 To 11',
  '        If k > 0 Then numbers = numbers & ","',
  '        numbers = numbers & AsmNumber(world(k))',
  '      Next',
  '      status = "resolved"',
  '      Emit "component", depth & "|" & joined & "|" & nm & "|" & pn & "|" & AsmNumber(world(3)) & "|" & AsmNumber(world(7)) & "|" & AsmNumber(world(11)) & "|" & numbers & "|" & status',
  '    Else',
  '      Emit "placementError", joined',
  '      Emit "component", depth & "|" & joined & "|" & nm & "|" & pn & "|||||unresolved"',
  '    End If',
  '    asmEmitted = asmEmitted + 1',
  '    AsmWalk child, joined, depth + 1, world, valid, depthCap, limit',
  '  Next',
  'End Sub',
].join('\n');

/**
 * Internals exposed so `test/schema.mjs` can compare the plugin's parameter compiler against the
 * harness's own author-facing compiler. Not used at runtime.
 */
export const __testHooks = { parameterSchema, valueSchema };
