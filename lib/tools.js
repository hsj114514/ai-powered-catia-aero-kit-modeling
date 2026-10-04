/**
 * Model-facing tools.
 *
 * One invariant shapes every design-changing tool: a mutation edits the project ledger and then
 * rebuilds the whole ledger into a **new numbered working copy**. Nothing is ever edited in place
 * and nothing already on disk is overwritten, so a rejected or failed change cannot destroy the
 * last valid state, and every iteration keeps its own version id. That is what makes rollback,
 * audit and reproducibility cheap rather than best-effort.
 *
 * @module lib/tools
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { LEVEL, LEVEL_LABEL, SCRATCH_PROJECT, safeName } from './bridge.js';
import { vbsStr as S, vbsNum as N } from './vbs.js';
import {
  EDITABLE,
  KIND_LEVEL,
  elementBounds,
  elementContext,
  elementFragment,
  expandRequest,
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
    execute,
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
  count: { type: 'number', description: 'Points per surface when resampling a profile; 20-160, default 40.' },
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
      if (entry.file && existsSync(path.join(bridge.projectPaths(ledger.project, false).dir, path.basename(entry.file)))) {
        return entry;
      }
    }
    return null;
  };

  /**
   * Rebuild the whole ledger into a new numbered working copy.
   * @param project - project name.
   * @param options - `note`, `op`, `level`, and an already-mutated ledger.
   * @returns the tool result value.
   */
  async function buildVersion(project, options) {
    const ledger = bridge.readLedger(project);
    if (!ledger) {
      return { status: 'BLOCKED', level: options.level ?? LEVEL.REFERENCE, project, errors: ['this project has no ledger yet'] };
    }
    const elements = Object.values(ledger.elements);
    const next = Number(ledger.version ?? 0) + 1;
    const base = `${ledger.project}_GEN_${String(next).padStart(3, '0')}`;
    const paths = bridge.projectPaths(project, true);
    const target = bridge.freePath(paths.dir, base, '.CATPart');

    const body = [
      'AttachCatia',
      'NewDocument',
      ...elements.map((element) => elementFragment(element, elementContext(element, ledger.elements))),
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
    const geometryComplete = built.length === elements.length;
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
        file,
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
      detail: 'The model could not be built; CATIA rolled back the geometry it had created in this attempt.',
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
    const ledger = bridge.readLedger(project) ?? bridge.initLedger(project);
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
    let result;
    try {
      bridge.withLedger(project, (current) => {
        for (const element of elements) current.elements[element.id] = element;
      });
      result = await buildVersion(project, {
        note: options.note ?? `add ${elements.map((e) => e.id).join(', ')}`,
        op: options.op,
        level: LEVEL.REFERENCE,
      });
    } catch (error) {
      restore(project, before);
      throw error;
    }
    if (result.status === 'FAILED') restore(project, before);
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
        const entry = args.version
          ? ledger.versions.find((v) => Number(v.version) === Number(args.version))
          : latestUsable(ledger);
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
        const entry = args.version
          ? ledger.versions.find((v) => Number(v.version) === Number(args.version))
          : latestUsable(ledger);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no version file on disk yet'] };
        const nameOf = (id) => {
          const element = ledger.elements[id];
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
        const value = Number(outcome.values.distance_mm);
        return {
          status: outcome.ok ? 'SUCCESS' : 'FAILED',
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
      'Check the design against hard constraints: maximum span/width/height, minimum ground clearance, and forbidden boxes. Read-only (Level 0) and computed from the recorded design, so it needs no CATIA session. Report a conflict instead of adjusting anything yourself.',
      {
        project: P.project,
        rules: {
          type: 'object',
          description: 'Constraints to enforce and store: maxSpan, maxWidth, maxHeight, minGroundClearance (millimetres), and exclusionZones as [{name, min:[x,y,z], max:[x,y,z]}].',
          additionalProperties: true,
        },
      },
      async (args) => {
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no ledger for this project'] };
        if (args.rules && typeof args.rules === 'object') {
          bridge.withLedger(project, (current) => {
            current.constraints = { ...(current.constraints ?? {}), ...args.rules };
          });
        }
        const rules = bridge.readLedger(project).constraints ?? {};
        const boxes = {};
        const violations = [];
        for (const element of Object.values(ledger.elements)) {
          const box = elementBounds(element, ledger.elements);
          if (!box) continue;
          boxes[element.id] = box;
        }
        const aggregate = Object.keys(boxes).length > 0
          ? {
            min: [0, 1, 2].map((axis) => Math.min(...Object.values(boxes).map((b) => b.min[axis]))),
            max: [0, 1, 2].map((axis) => Math.max(...Object.values(boxes).map((b) => b.max[axis]))),
          }
          : null;
        const metrics = {};
        if (aggregate) {
          const [minX, minY, minZ] = aggregate.min;
          const [maxX, maxY, maxZ] = aggregate.max;
          const span = Math.max(Math.abs(minZ), Math.abs(maxZ)) * 2;
          const width = maxZ - minZ;
          const height = maxY - minY;
          metrics.span_mm = span.toFixed(1);
          metrics.width_mm = width.toFixed(1);
          metrics.height_mm = height.toFixed(1);
          metrics.length_mm = (maxX - minX).toFixed(1);
          metrics.lowestPoint_mm = minY.toFixed(1);
          if (rules.maxSpan && span > rules.maxSpan) violations.push(`span ${span.toFixed(1)} mm exceeds maxSpan ${rules.maxSpan} mm`);
          if (rules.maxWidth && width > rules.maxWidth) violations.push(`width ${width.toFixed(1)} mm exceeds maxWidth ${rules.maxWidth} mm`);
          if (rules.maxHeight && height > rules.maxHeight) violations.push(`height ${height.toFixed(1)} mm exceeds maxHeight ${rules.maxHeight} mm`);
          if (rules.minGroundClearance !== undefined && minY < rules.minGroundClearance) {
            violations.push(`lowest point ${minY.toFixed(1)} mm is below the required ground clearance ${rules.minGroundClearance} mm`);
          }
          for (const zone of Array.isArray(rules.exclusionZones) ? rules.exclusionZones : []) {
            if (!Array.isArray(zone?.min) || !Array.isArray(zone?.max)) continue;
            for (const [id, box] of Object.entries(boxes)) {
              const overlaps = [0, 1, 2].every((axis) => box.max[axis] >= Number(zone.min[axis]) && box.min[axis] <= Number(zone.max[axis]));
              if (overlaps) violations.push(`${id} intersects exclusion zone ${zone.name ?? 'unnamed'}`);
            }
          }
        }
        return {
          status: violations.length === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS',
          level: LEVEL.READ,
          project,
          version: ledger.version,
          metrics,
          items: Object.entries(boxes).map(([id, box]) => `${id}: ${box.min.map((v) => v.toFixed(1)).join(',')} .. ${box.max.map((v) => v.toFixed(1)).join(',')}`),
          errors: violations,
          detail: violations.length === 0
            ? 'All recorded constraints are satisfied by the ledger geometry.'
            : 'Constraint conflicts found; resolve them with the user before modelling further.',
          notes: Object.keys(boxes).length === 0 ? ['No element geometry could be derived from the ledger.'] : [],
        };
      },
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
        const pairs = Array.isArray(args.pairs) ? args.pairs : [];
        if (pairs.length === 0) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['pairs must not be empty'] };
        if (pairs.length > 24) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['at most 24 pairs per call'] };
        const entry = args.version
          ? ledger.versions.find((v) => Number(v.version) === Number(args.version))
          : latestUsable(ledger);
        if (!entry) return { status: 'BLOCKED', level: LEVEL.READ, project, errors: ['no version file on disk yet'] };
        const body = ['AttachCatia', openVersion(ledger, entry)];
        const nameOf = (id) => ledger.elements[id]?.features?.[0] ?? String(id);
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
        const threshold = Number(args.minDistance);
        pairs.forEach((pair, index) => {
          const value = Number(outcome.values[`d${index}`]);
          if (!Number.isFinite(value)) {
            items.push(`${pair.from} -> ${pair.to}: not measured`);
            return;
          }
          items.push(`${pair.from} -> ${pair.to}: ${value.toFixed(2)} mm`);
          if (Number.isFinite(threshold) && value < threshold) {
            violations.push(`${pair.from} -> ${pair.to} is ${value.toFixed(2)} mm, below the required ${threshold} mm`);
          }
        });
        return {
          status: violations.length === 0 ? (outcome.ok ? 'SUCCESS' : 'FAILED') : 'PARTIAL_SUCCESS',
          level: LEVEL.READ,
          project,
          version: entry.version,
          items,
          errors: [...violations, ...outcome.errors],
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
      'Add a flap element positioned relative to an existing wing element, as a new version (Level 1, reversible). Gap and overlap are measured from the parent trailing edge: overlap moves the flap leading edge forward along the parent chord line, gap moves it down perpendicular to that line.',
      {
        project: P.project,
        id: P.id,
        parentId: { type: 'string', required: true, description: 'Id of the wing element this flap follows; the flap inherits its spanwise stations.' },
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
      'Add a complete multi-element wing: one main wing plus its flap elements, in a single version (Level 1, reversible). Use it for the common case of a main plane with one or two flaps rather than calling catia_wing and catia_flap repeatedly.',
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
          elementFragment(candidate, elementContext(candidate, probe));
          for (const dependent of Object.values(ledger.elements)) {
            if (dependent.params?.parentId === candidate.id) {
              elementFragment(dependent, elementContext(dependent, probe));
            }
          }
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
        if (result.status === 'FAILED') restore(project, dump);
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
        if (result.status === 'FAILED') restore(project, dump);
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
        if (!['step', 'stl'].includes(args.format)) {
          throw new Error('format must be step or stl');
        }
        const project = projectOf(args);
        const ledger = bridge.readLedger(project);
        if (!ledger) return { status: 'BLOCKED', level: LEVEL.REFERENCE, project, errors: ['no ledger for this project'] };
        const entry = args.version
          ? ledger.versions.find((v) => Number(v.version) === Number(args.version))
          : latestUsable(ledger);
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

  return [...Object.values(readTools), ...Object.values(designTools)].map((definition) => {
    const execute = definition.execute;
    definition.execute = async (args, ...context) => {
      try {
        return await execute(args, ...context);
      } catch (error) {
        const requestedProject = typeof args?.project === 'string' ? args.project : SCRATCH_PROJECT;
        let project = SCRATCH_PROJECT;
        try { project = safeName(requestedProject, 'project'); } catch { /* record invalid project requests in the scratch audit */ }
        const level = definition.name === 'catia_set_aero_param'
          ? LEVEL.MODIFY
          : ['catia_env', 'catia_tree', 'catia_read', 'catia_measure', 'catia_check_clearance', 'catia_check_rules', 'catia_audit'].includes(definition.name)
            ? LEVEL.READ
            : LEVEL.REFERENCE;
        const message = String(error?.message ?? error).slice(0, 2000);
        try {
          bridge.audit(project, { tool: definition.name, level, status: 'blocked', reason: message });
        } catch { /* preserve the structured tool result if the audit directory is unavailable */ }
        return {
          status: 'BLOCKED',
          level,
          project,
          detail: 'The request was rejected or could not be completed.',
          errors: [message],
        };
      }
    };
    return definition;
  });
}

/**
 * Internals exposed so `test/schema.mjs` can compare the plugin's parameter compiler against the
 * harness's own author-facing compiler. Not used at runtime.
 */
export const __testHooks = { parameterSchema, valueSchema };
