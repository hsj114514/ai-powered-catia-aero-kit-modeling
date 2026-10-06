// SPDX-License-Identifier: GPL-3.0-only
/**
 * STEP (ISO 10303-21) assembly reader.
 *
 * Reads an AP203/AP214 assembly without CATIA and without holding the file in memory. STEP entity
 * ids are dense positive integers, so every lookup is a flat typed array indexed by id rather than a
 * hash map; that keeps a 240 MB / 3.4M-entity export inside a few hundred megabytes of working set
 * across the streaming passes.
 *
 * Two questions are answered from different sources, because they have different guarantees:
 *
 *  1. Where is each component? Reconstructed from the assembly structure and composed down the tree
 *     into the root frame. CATIA exports the placement as
 *     `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(relationship, product_definition_shape)` and attaches
 *     the transform to the *relationship*, so the association to a
 *     `NEXT_ASSEMBLY_USAGE_OCCURRENCE` is made through the child product definition, in file order.
 *     Where a child definition is instanced more than once the placements and usages are zipped in
 *     order, and the result is cross-checked against the relationship's own shape representations;
 *     the match rate is reported in `stats` so the association can be judged rather than trusted.
 *  2. Where might each component extend? An approximate box from reachable geometry and full
 *     nonrational control nets. Filtering, missing geometry and unsupported entities are reported.
 *     The parser is not a CAD kernel; returned boxes never certify clearance or compliance.
 *
 * Nothing is fabricated: an unresolved placement stays `null` and is counted, never replaced with an
 * identity transform.
 *
 * @module lib/assembly
 */
import { createReadStream, statSync } from 'node:fs';

/** Entity types whose references are followed when walking down from a shape representation. */
const GEOMETRY_TYPES = new Set([
  'SHAPE_REPRESENTATION',
  'ADVANCED_BREP_SHAPE_REPRESENTATION', 'MANIFOLD_SURFACE_SHAPE_REPRESENTATION', 'GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION',
  'MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS', 'FACETED_BREP', 'SHELL_BASED_SURFACE_MODEL', 'OPEN_SHELL', 'CLOSED_SHELL',
  'ADVANCED_FACE', 'FACE_SURROUND', 'FACE_BOUND', 'FACE_OUTER_BOUND', 'EDGE_LOOP', 'POLY_LOOP', 'ORIENTED_EDGE', 'EDGE_CURVE',
  'VERTEX_POINT', 'CARTESIAN_POINT', 'CIRCLE', 'ELLIPSE', 'LINE', 'POLYLINE', 'B_SPLINE_CURVE', 'B_SPLINE_CURVE_WITH_KNOTS',
  'RATIONAL_B_SPLINE_CURVE', 'B_SPLINE_SURFACE', 'B_SPLINE_SURFACE_WITH_KNOTS', 'RATIONAL_B_SPLINE_SURFACE', 'PLANE',
  'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SPHERICAL_SURFACE', 'TOROIDAL_SURFACE', 'SURFACE_OF_REVOLUTION',
  'SURFACE_OF_LINEAR_EXTRUSION', 'SWEPT_SURFACE', 'TRIMMED_CURVE', 'COMPOSITE_CURVE', 'COMPOSITE_CURVE_SEGMENT',
  'CURVE_REPLICA', 'SURFACE_REPLICA', 'AXIS2_PLACEMENT_3D', 'AXIS2_PLACEMENT_2D', 'AXIS1_PLACEMENT', 'DIRECTION', 'VECTOR',
  'GEOMETRIC_CURVE_SET', 'GEOMETRIC_SET', 'SURFACE_PATCH', 'CURVE_BOUNDED_SURFACE', 'BOUNDED_SURFACE', 'OFFSET_SURFACE',
  'RECTANGULAR_TRIMMED_SURFACE',
]);

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Entities the component-envelope walk must not descend into.
 * A placement frame is a *coordinate system*, and an assembly-level shape representation lists the
 * frames of its children. Following them attributes other components' frame origins to this one 鈥? * measured on a real export, that is what gave six sibling sub-assemblies one shared 3.9 m box and
 * left most nodes with a degenerate zero-size box. Points are still reached through the geometry
 * itself (vertices, B-spline control points), which is what bounds a surface.
 */
const SKIP_IN_GEOMETRY = new Set(['AXIS2_PLACEMENT_3D', 'AXIS2_PLACEMENT_2D', 'AXIS1_PLACEMENT', 'DIRECTION', 'VECTOR']);

/**
 * Geometry whose extent is its placement centre plus a radius. Their own definition points and
 * placement origins are construction data, so the walk bounds them explicitly instead of collecting
 * points. Without this, a circular face edge could be under-reported between its vertices.
 */
const RADIUS_TYPES = new Set(['CIRCLE', 'ELLIPSE', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE', 'SPHERICAL_SURFACE', 'TOROIDAL_SURFACE']);

/**
 * Decode an ISO 10303-21 string literal body.
 * Handles `''` for a quote plus the `\X2\<utf16be>\X0\`, `\X4\`, `\X\hh` and `\S\c` escapes CATIA
 * uses to carry non-ASCII part names.
 * @param raw - literal body without surrounding quotes.
 * @returns decoded text.
 */
export function decodeStepString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const rest = raw.slice(i);
    let match = /^\\X2\\((?:[0-9A-Fa-f]{4})+)\\X0\\/.exec(rest);
    if (match) {
      for (let k = 0; k < match[1].length; k += 4) out += String.fromCharCode(parseInt(match[1].slice(k, k + 4), 16));
      i += match[0].length - 1;
      continue;
    }
    match = /^\\X4\\((?:[0-9A-Fa-f]{8})+)\\X0\\/.exec(rest);
    if (match) {
      for (let k = 0; k < match[1].length; k += 8) out += String.fromCodePoint(parseInt(match[1].slice(k, k + 8), 16));
      i += match[0].length - 1;
      continue;
    }
    match = /^\\X\\([0-9A-Fa-f]{2})/.exec(rest);
    if (match) {
      out += String.fromCharCode(parseInt(match[1], 16));
      i += match[0].length - 1;
      continue;
    }
    match = /^\\S\\(.)/.exec(rest);
    if (match) {
      out += String.fromCharCode(match[1].charCodeAt(0) + 128);
      i += match[0].length - 1;
      continue;
    }
    if (rest.startsWith('\\\\')) {
      out += '\\';
      i += 1;
      continue;
    }
    out += ch;
  }
  // A literal apostrophe is written as a doubled quote; the escapes processed above never contain
  // one, so un-doubling at the end is safe.
  return out.replace(/''/g, "'").trim();
}

/** Record text with string literal bodies blanked, so parens and `#` inside names cannot mislead. */
function withoutStrings(record) {
  return record.replace(/'(?:[^']|'')*'/g, "''");
}

/** Every entity reference of a record whose literals are already blanked. */
function allReferences(flat) {
  const out = [];
  const re = /#(\d+)/g;
  let match = re.exec(flat);
  while (match !== null) {
    out.push(Number(match[1]));
    match = re.exec(flat);
  }
  return out;
}

/**
 * Entity references inside one named member of a record.
 * The pattern must end with the opening parenthesis, so `PRODUCT_DEFINITION\(` cannot also match
 * `PRODUCT_DEFINITION_SHAPE\(`.
 * @param flat - record text with literals blanked.
 * @param pattern - regular expression source ending in `\\(`.
 * @returns referenced ids in order, or an empty array.
 */
function memberReferences(flat, pattern) {
  const match = new RegExp(pattern).exec(flat);
  if (!match) return [];
  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < flat.length; i += 1) {
    const ch = flat[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) {
        const out = [];
        const re = /#(\d+)/g;
        const body = flat.slice(open + 1, i);
        let m = re.exec(body);
        while (m !== null) {
          out.push(Number(m[1]));
          m = re.exec(body);
        }
        return out;
      }
    }
  }
  return [];
}

/** First string literal of a record, decoded. */
function firstString(record) {
  const match = /'((?:[^']|'')*)'/.exec(record);
  return match ? decodeStepString(match[1]) : '';
}

/** Entity id of a record: simple `#12=TYPE(` or complex `#12=(...`. */
function recordId(record) {
  const match = /^\s*#(\d+)\s*=/.exec(record);
  return match ? Number(match[1]) : null;
}

/** Entity type keyword immediately after `=`, or the first member of a complex instance. */
function recordType(record) {
  const eq = record.indexOf('=');
  if (eq < 0) return '';
  const match = /^\s*\(?\s*([A-Z][A-Z0-9_]*)\s*\(/.exec(record.slice(eq + 1));
  return match ? match[1] : '';
}

/**
 * Split a STEP stream into `;`-terminated records, ignoring semicolons inside string literals.
 *
 * The subtlety is a chunk boundary landing inside an escaped quote pair. The fix is to carry the
 * trailing quote into the *next scan* rather than only into the output: appending it to the output
 * alone hides it from the state machine, so the literal state drifts by one quote per affected chunk
 * and everything between two such drifts is merged into a single record (measured on a real export:
 * one drift swallowed 79 MB of entities).
 */
function createSplitter(onRecord, maxRecordChars) {
  let record = '';
  let inString = false;
  let carry = '';
  return {
    push(chunk) {
      const text = carry + chunk;
      carry = '';
      let scanEnd = text.length;
      if (text.endsWith("'") && !text.endsWith("''")) {
        carry = "'";
        scanEnd -= 1;
      }
      let start = 0;
      for (let i = 0; i < scanEnd; i += 1) {
        const ch = text[i];
        if (ch === "'") {
          if (inString && text[i + 1] === "'") {
            i += 1;
            continue;
          }
          inString = !inString;
          continue;
        }
        if (ch === ';' && !inString) {
          record += text.slice(start, i);
          if (record.length > maxRecordChars) throw new Error(`STEP record exceeds ${maxRecordChars} characters`);
          onRecord(record);
          record = '';
          start = i + 1;
        }
      }
      record += text.slice(start, scanEnd);
      if (record.length > maxRecordChars) throw new Error(`STEP record exceeds ${maxRecordChars} characters`);
    },
    end() {
      if (carry !== '') record += carry;
      carry = '';
      if (record.trim() !== '') onRecord(record);
      record = '';
    },
  };
}

/** One streaming pass over the file. */
function passFile(filePath, onRecord, maxRecordChars = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const splitter = createSplitter(onRecord, maxRecordChars);
    const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 22 });
    stream.on('data', (chunk) => {
      try { splitter.push(chunk); } catch (error) { stream.destroy(error); }
    });
    stream.on('error', reject);
    stream.on('end', () => {
      try { splitter.end(); resolve(undefined); } catch (error) { reject(error); }
    });
  });
}

/** Multiply two row-major 4x4 matrices. */
export function multiply4(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[row * 4 + k] * b[k * 4 + col];
      out[row * 4 + col] = sum;
    }
  }
  return out;
}

/** Invert a rigid-body row-major 4x4. */
export function invertRigid(m) {
  const t = [m[3], m[7], m[11]];
  const out = new Array(16).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) out[row * 4 + col] = m[col * 4 + row];
  }
  out[15] = 1;
  out[3] = -(out[0] * t[0] + out[1] * t[1] + out[2] * t[2]);
  out[7] = -(out[4] * t[0] + out[5] * t[1] + out[6] * t[2]);
  out[11] = -(out[8] * t[0] + out[9] * t[1] + out[10] * t[2]);
  return out;
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n < 1e-12 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
}

/** Build a row-major 4x4 from an AXIS2_PLACEMENT_3D: origin, Z axis, X reference direction. */
export function frameToMatrix(origin, axis, refDirection) {
  const z = normalize(axis);
  let x = normalize(refDirection);
  let y = cross(z, x);
  if (Math.hypot(y[0], y[1], y[2]) < 1e-9) {
    x = normalize(Math.abs(z[0]) < 0.9 ? cross([1, 0, 0], z) : cross([0, 1, 0], z));
    y = cross(z, x);
  }
  y = normalize(y);
  x = normalize(cross(y, z));
  return [
    x[0], y[0], z[0], origin[0],
    x[1], y[1], z[1], origin[1],
    x[2], y[2], z[2], origin[2],
    0, 0, 0, 1,
  ];
}

/** Apply a row-major 4x4 to a point. */
export function applyPoint(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
  ];
}

/** Compact a 4x4 into the 12-number row-major 3x4 form used in tool output. */
export function toRowMajor34(m) {
  return [m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]];
}

/** Enclosing axis-aligned box of a box transformed by a matrix. */
export function transformBox(m, box) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner += 1) {
    const p = [
      (corner & 1) === 0 ? box.min[0] : box.max[0],
      (corner & 2) === 0 ? box.min[1] : box.max[1],
      (corner & 4) === 0 ? box.min[2] : box.max[2],
    ];
    const q = applyPoint(m, p);
    for (let axis = 0; axis < 3; axis += 1) {
      if (q[axis] < min[axis]) min[axis] = q[axis];
      if (q[axis] > max[axis]) max[axis] = q[axis];
    }
  }
  return { min, max };
}

/** Merge two boxes, tolerating nulls. */
export function mergeBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Parse the first `(x,y,z)` triple of a CARTESIAN_POINT or DIRECTION record. */
function parseTriple(record) {
  const match = /\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/.exec(record);
  if (!match) return null;
  const values = [Number(match[1]), Number(match[2]), Number(match[3])];
  return values.every((v) => Number.isFinite(v)) ? values : null;
}

const MEMBER = {
  product: '(?:^|[^A-Z0-9_])PRODUCT\\(',
  productDefinition: '(?:^|[^A-Z0-9_])(?:PRODUCT_DEFINITION|PRODUCT_DEFINITION_WITH_ASSOCIATED_DOCUMENTS)\\(',
  formation: '(?:^|[^A-Z0-9_])PRODUCT_DEFINITION_FORMATION[A-Z_]*\\(',
  definitionShape: '(?:^|[^A-Z0-9_])PRODUCT_DEFINITION_SHAPE\\(',
  shapeDefinition: '(?:^|[^A-Z0-9_])SHAPE_DEFINITION_REPRESENTATION\\(',
  usage: '(?:^|[^A-Z0-9_])NEXT_ASSEMBLY_USAGE_OCCURRENCE\\(',
  contextDependentShape: '(?:^|[^A-Z0-9_])CONTEXT_DEPENDENT_SHAPE_REPRESENTATION\\(',
  relationship: '(?:^|[^A-Z0-9_])REPRESENTATION_RELATIONSHIP\\(',
  itemTransform: '(?:^|[^A-Z0-9_])ITEM_DEFINED_TRANSFORMATION\\(',
  shapeRepresentationRelationship: '(?:^|[^A-Z0-9_])SHAPE_REPRESENTATION_RELATIONSHIP\\(',
  axisPlacement: '(?:^|[^A-Z0-9_])AXIS2_PLACEMENT_3D\\(',
  vertexPoint: '(?:^|[^A-Z0-9_])VERTEX_POINT\\(',
  polyline: '(?:^|[^A-Z0-9_])POLYLINE\\(',
};

/**
 * Member pattern per radius-bearing type. The argument list of each starts with its placement, so the
 * first reference inside the member is the frame whose origin the radius is measured from.
 */
const RADIUS_MEMBER = new Map([
  ['CIRCLE', '(?:^|[^A-Z0-9_])CIRCLE\\('],
  ['ELLIPSE', '(?:^|[^A-Z0-9_])ELLIPSE\\('],
  ['CYLINDRICAL_SURFACE', '(?:^|[^A-Z0-9_])CYLINDRICAL_SURFACE\\('],
  ['CONICAL_SURFACE', '(?:^|[^A-Z0-9_])CONICAL_SURFACE\\('],
  ['SPHERICAL_SURFACE', '(?:^|[^A-Z0-9_])SPHERICAL_SURFACE\\('],
  ['TOROIDAL_SURFACE', '(?:^|[^A-Z0-9_])TOROIDAL_SURFACE\\('],
]);

/**
 * Read assembly structure, placements and per-component geometry envelopes from a STEP file.
 *
 * @param filePath - `.stp`/`.step` file to read; never written to.
 * @param options - `includeBounds` (default false) walks geometry for approximate component envelopes,
 *   `maxInstances` caps the returned rows, `onProgress` receives a pass label.
 * @returns `{ instances, roots, envelope, globalPointEnvelope, stats }`.
 */
export async function readStepAssembly(filePath, options = {}) {
  // Opt-in approximate geometry. Unresolved/filtered geometry is reported per instance and no
  // returned box is certified for collision-free placement or rule compliance.
  for (const key of ['maxInstances', 'maxFileBytes', 'maxEntities', 'maxRecordChars', 'maxEnvelopeBytes', 'maxEnvelopeRadiusMm', 'maxControlPointMarginMm', 'maxPlausibleExtentMm']) {
    if (options[key] !== undefined && (typeof options[key] !== 'number' || !Number.isFinite(options[key]) || options[key] <= 0)) {
      throw new Error(`${key} must be a positive finite number`);
    }
  }
  const includeBounds = options.includeBounds === true;
  const maxInstances = Math.max(1, Math.trunc(options.maxInstances ?? 20000));
  const maxFileBytes = Math.max(1, Math.min(2 * 1024 ** 3, Math.trunc(options.maxFileBytes ?? 1024 ** 3)));
  const maxEntities = Math.max(100000, Math.min(5000000, Math.trunc(options.maxEntities ?? 5000000)));
  const maxRecordChars = Math.max(1024 * 1024, Math.min(64 * 1024 * 1024, Math.trunc(options.maxRecordChars ?? 64 * 1024 * 1024)));
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const size = statSync(filePath).size;
  if (size > maxFileBytes) throw new Error(`STEP file exceeds the ${maxFileBytes}-byte safety limit`);

  // ---- pass 1: structure ----
  onProgress('structure');
  const products = new Map();
  const productDefinitions = new Map();
  const formations = new Map();
  const usageOccurrences = new Map();
  const definitionShape = new Map();
  const shapeDefinition = new Map();
  const representationRelations = [];
  const contexts = [];
  const relationshipRepresentations = new Map();
  const relationshipTransform = new Map();
  const transformFrames = new Map();
  let maxId = 0;
  let entities = 0;

  await passFile(filePath, (record) => {
    const id = recordId(record);
    if (id === null) return;
    entities += 1;
    if (entities > maxEntities) throw new Error(`STEP entity count exceeds the ${maxEntities}-entity safety limit`);
    if (id > maxId) maxId = id;
    const flat = withoutStrings(record);
    if (flat.includes('PRODUCT(')) products.set(id, firstString(record));

    const formation = memberReferences(flat, MEMBER.formation);
    if (formation.length > 0) {
      formations.set(id, formation[0]);
    } else {
      const definition = memberReferences(flat, MEMBER.productDefinition);
      if (definition.length > 0) productDefinitions.set(id, definition[0]);
    }

    const shape = memberReferences(flat, MEMBER.definitionShape);
    if (shape.length > 0) definitionShape.set(id, shape[shape.length - 1]);

    const shapeDefinitionRefs = memberReferences(flat, MEMBER.shapeDefinition);
    if (shapeDefinitionRefs.length >= 2) shapeDefinition.set(shapeDefinitionRefs[0], shapeDefinitionRefs[1]);

    const usage = memberReferences(flat, MEMBER.usage);
    if (usage.length >= 2) usageOccurrences.set(id, { name: firstString(record), parent: usage[0], child: usage[1] });

    const context = memberReferences(flat, MEMBER.contextDependentShape);
    if (context.length >= 2) contexts.push({ relationship: context[0], definitionShape: context[1] });

    const relationship = memberReferences(flat, MEMBER.relationship);
    if (relationship.length >= 2) relationshipRepresentations.set(id, { first: relationship[0], second: relationship[1] });

    const transform = memberReferences(flat, MEMBER.itemTransform);
    if (transform.length >= 2) transformFrames.set(id, { from: transform[0], to: transform[1] });

    const withTransform = /REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)/.exec(flat);
    if (withTransform) relationshipTransform.set(id, Number(withTransform[1]));

    // A part's shape definition points at its *placement* representation; the solid hangs off a
    // separate representation joined by a plain SHAPE_REPRESENTATION_RELATIONSHIP. Only the plain
    // form is collected: the complex REPRESENTATION_RELATIONSHIP ties an instance to its parent's
    // context, and following that is what pulls other components' frames into this one.
    if (recordType(record) === 'SHAPE_REPRESENTATION_RELATIONSHIP') {
      const refs = memberReferences(flat, MEMBER.shapeRepresentationRelationship);
      if (refs.length >= 2) representationRelations.push([refs[0], refs[1]]);
    }
  }, maxRecordChars);

  // product definition -> shape representation
  const shapeByProductDefinition = new Map();
  for (const [definition, representation] of shapeDefinition) {
    const pd = definitionShape.get(definition);
    if (pd !== undefined && pd !== null) shapeByProductDefinition.set(pd, representation);
  }

  // Placements: CONTEXT_DEPENDENT_SHAPE_REPRESENTATION -> PRODUCT_DEFINITION_SHAPE -> the usage
  // occurrence it annotates. Verified against a real CATIA export, where the shape's definition
  // reference is the NEXT_ASSEMBLY_USAGE_OCCURRENCE id itself, so the association is exact and no
  // ordering heuristic is needed.
  const framesByUsage = new Map();
  let representationMatches = 0;
  let representationMismatches = 0;
  let contextsWithoutUsage = 0;
  for (const context of contexts) {
    const nauo = definitionShape.get(context.definitionShape);
    if (nauo === undefined || nauo === null) {
      contextsWithoutUsage += 1;
      continue;
    }
    const transformId = relationshipTransform.get(context.relationship) ?? context.relationship;
    const frames = transformFrames.get(transformId);
    if (!frames) continue;
    const usage = usageOccurrences.get(nauo);
    const reps = relationshipRepresentations.get(context.relationship);
    if (usage && reps) {
      // The relationship's first shape representation must be the child's own: a mismatch means the
      // transform is not the one this usage carries, which is worth reporting rather than ignoring.
      const childRep = shapeByProductDefinition.get(usage.child) ?? null;
      if (childRep !== null && (reps.first === childRep || reps.second === childRep)) representationMatches += 1;
      else representationMismatches += 1;
    }
    framesByUsage.set(nauo, frames);
  }

  // ---- pass 2: frames of the placements ----
  onProgress('placements');
  const wantedFrames = new Set();
  for (const frames of framesByUsage.values()) {
    wantedFrames.add(frames.from);
    wantedFrames.add(frames.to);
  }
  const frameRefs = new Map();
  const wantedTriples = new Set();
  await passFile(filePath, (record) => {
    const id = recordId(record);
    if (id === null || !wantedFrames.has(id)) return;
    const refs = memberReferences(withoutStrings(record), MEMBER.axisPlacement);
    if (refs.length < 3) return;
    frameRefs.set(id, { origin: refs[0], axis: refs[1], ref: refs[2] });
    wantedTriples.add(refs[0]);
    wantedTriples.add(refs[1]);
    wantedTriples.add(refs[2]);
  });

  // ---- pass 3: the points and directions those frames use ----
  const tripleById = new Map();
  await passFile(filePath, (record) => {
    const id = recordId(record);
    if (id === null || !wantedTriples.has(id)) return;
    const triple = parseTriple(record);
    if (triple) tripleById.set(id, triple);
  });

  const frameMatrix = (frameId) => {
    const refs = frameRefs.get(frameId);
    if (!refs) return null;
    return frameToMatrix(
      tripleById.get(refs.origin) ?? [0, 0, 0],
      tripleById.get(refs.axis) ?? [0, 0, 1],
      tripleById.get(refs.ref) ?? [1, 0, 0],
    );
  };

  // Representations joined by SHAPE_REPRESENTATION_RELATIONSHIP form a per-part group, and the group
  // is what has to be walked: the shape definition only reaches the placement representation. The
  // relationship points at the representations rather than being referenced by them, so a forward
  // walk cannot discover it and the group is resolved up front instead.
  const repRelations = new Map();
  for (const [a, b] of representationRelations) {
    if (!repRelations.has(a)) repRelations.set(a, new Set());
    if (!repRelations.has(b)) repRelations.set(b, new Set());
    repRelations.get(a).add(b);
    repRelations.get(b).add(a);
  }
  const repGroupCache = new Map();
  const repGroupOf = (start) => {
    const cached = repGroupCache.get(start);
    if (cached) return cached;
    const group = [start];
    const seen = new Set([start]);
    for (let i = 0; i < group.length; i += 1) {
      for (const next of repRelations.get(group[i]) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          group.push(next);
        }
      }
    }
    repGroupCache.set(start, group);
    return group;
  };

  // ---- assemble the instance tree ----
  const childrenOf = new Map();
  const childDefinitions = new Set();
  for (const [nauo, usage] of usageOccurrences) {
    if (usage.parent === null || usage.child === null) continue;
    childDefinitions.add(usage.child);
    if (!childrenOf.has(usage.parent)) childrenOf.set(usage.parent, []);
    childrenOf.get(usage.parent).push({ nauo, ...usage });
  }
  const allParents = [...childrenOf.keys()];
  const roots = allParents.filter((pd) => !childDefinitions.has(pd));

  const labelOf = (pd) => {
    const formation = productDefinitions.get(pd);
    const product = formation === null || formation === undefined ? null : formations.get(formation);
    return product === null || product === undefined ? null : products.get(product) ?? null;
  };

  const instances = [];
  let unresolvedPlacements = 0;
  let maxDepth = 0;
  const queue = roots.map((root) => ({
    pd: root,
    world: [...IDENTITY],
    depth: 0,
    path: labelOf(root) ?? `#${root}`,
    name: labelOf(root) ?? `#${root}`,
    partNumber: labelOf(root) ?? `#${root}`,
    parentIndex: -1,
    instanceIndex: -1,
  }));
  let cursor = 0;
  while (cursor < queue.length && instances.length < maxInstances) {
    const node = queue[cursor];
    cursor += 1;
    if (node.depth > 0) {
      node.instanceIndex = instances.length;
      instances.push({
        path: node.path,
        name: node.name,
        partNumber: node.partNumber,
        depth: node.depth,
        placementResolved: node.world !== null,
        parentIndex: node.parentIndex,
        shapeRepresentation: shapeByProductDefinition.get(node.pd) ?? null,
        matrix: node.world === null ? null : toRowMajor34(node.world),
        origin: node.world === null ? null : [node.world[3], node.world[7], node.world[11]],
      });
      if (node.world !== null && node.depth > maxDepth) maxDepth = node.depth;
    }
    for (const child of childrenOf.get(node.pd) ?? []) {
      const frames = framesByUsage.get(child.nauo);
      let local = null;
      if (frames) {
        const from = frameMatrix(frames.from);
        const to = frameMatrix(frames.to);
        if (to) local = from ? multiply4(to, invertRigid(from)) : to;
      }
      if (!local) unresolvedPlacements += 1;
      const label = labelOf(child.child);
      const instanceName = child.name || label || `#${child.child}`;
      queue.push({
        pd: child.child,
        world: node.world === null || local === null ? null : multiply4(node.world, local),
        depth: node.depth + 1,
        path: `${node.path}/${instanceName}`,
        name: instanceName,
        partNumber: label ?? `#${child.child}`,
        parentIndex: node.instanceIndex,
        instanceIndex: -1,
      });
    }
  }

  // ---- geometry envelopes ----
  // Each instance gets the box of the points reachable from its own shape representation while NOT
  // passing through a placement frame (see SKIP_IN_GEOMETRY). A component whose representation holds
  // only frames is reported as having no geometry of its own rather than being handed a fabricated
  // box, and every sub-assembly additionally gets the union of its children so it stays locatable.
  let envelope = null;
  let globalPointEnvelope = null;
  let boundsFromGeometry = 0;
  let boundsWithoutGeometry = 0;
  let subtreeOnlyEnvelopes = 0;
  let envelopeMemoryBytes = 0;
  let oversizedRadii = 0;
  let rationalSplinesSkipped = 0;
  let distantRadiiSkipped = 0;
  let distantControlPointsSkipped = 0;
  let boundsSuspect = 0;
  let boundsIncomplete = 0;
  const boundsMethod = 'points-reachable-without-placement-frames';
  const boundsValidation = includeBounds ? 'approximate-not-certified' : 'not-computed';
  if (includeBounds) {
    onProgress('geometry');
    // Memory is dominated by per-id arrays: an Int32 index, a Uint8 skip flag, three Float64
    // coordinates and an Int32 visit stamp 鈥?about 52 bytes per entity id. The budget is expressed in
    // bytes and can be raised, so the limit is explainable instead of an unexplained magic number.
    envelopeMemoryBytes = (maxId + 1) * 52;
    const envelopeBudget = Math.max(16 * 1024 * 1024, Math.trunc(options.maxEnvelopeBytes ?? 512 * 1024 * 1024));
    // Large radii can describe near-planar supporting surfaces. Excluding them is a heuristic,
    // not proof that they are construction-only: affected instances must be marked incomplete.
    const maxEnvelopeRadius = Math.max(1, Number(options.maxEnvelopeRadiusMm ?? 2000));
    const maxPlausibleExtent = Math.max(100, Number(options.maxPlausibleExtentMm ?? 5000));
    if (envelopeMemoryBytes > envelopeBudget) {
      throw new Error(
        `component-envelope calculation needs about ${(envelopeMemoryBytes / 1048576).toFixed(0)} MB for ${maxId} entity ids, `
        + `above the ${(envelopeBudget / 1048576).toFixed(0)} MB budget; raise maxEnvelopeBytes or leave includeBounds off`,
      );
    }
    let geometryCount = 0;
    let referenceCount = 0;
    await passFile(filePath, (record) => {
      if (!GEOMETRY_TYPES.has(recordType(record))) return;
      geometryCount += 1;
      const flat = withoutStrings(record);
      const re = /#(\d+)/g;
      let m = re.exec(flat);
      while (m !== null) {
        referenceCount += 1;
        m = re.exec(flat);
      }
    });

    // Include the reference graph and traversal queue, not just the per-id arrays. This is a typed
    // array allocation budget, not a bound on the entire Node process or its Maps/strings.
    envelopeMemoryBytes = (maxId + 1) * 48 + (geometryCount + 1) * 4 + referenceCount * 4 + (geometryCount + 2) * 4;
    if (!Number.isSafeInteger(maxId) || maxId > 0x7ffffffe || envelopeMemoryBytes > envelopeBudget) {
      throw new Error(`component-envelope typed arrays require ${Math.ceil(envelopeMemoryBytes / 1048576)} MiB, above the configured budget or supported id range`);
    }
    const geometryIssues = new Map();
    const indexById = new Int32Array(maxId + 1).fill(-1);
    const offsets = new Int32Array(geometryCount + 1);
    const flatRefs = new Int32Array(referenceCount);
    const isPoint = new Uint8Array(maxId + 1);
    const collectPoint = new Uint8Array(maxId + 1);
    const isShapeRep = new Uint8Array(maxId + 1);
    const radiusById = new Float32Array(maxId + 1);
    const axisRefById = new Int32Array(maxId + 1);
    const axisLocationRef = new Int32Array(maxId + 1);
    const skipFrame = new Uint8Array(maxId + 1);
    const coords = new Float64Array(3 * (maxId + 1));
    let geometryIndex = 0;
    let referenceCursor = 0;

    await passFile(filePath, (record) => {
      const id = recordId(record);
      if (id === null) return;
      const type = recordType(record);
      if (type === 'CARTESIAN_POINT') {
        const triple = parseTriple(record);
        if (triple) {
          isPoint[id] = 1;
          coords[id * 3] = triple[0];
          coords[id * 3 + 1] = triple[1];
          coords[id * 3 + 2] = triple[2];
          globalPointEnvelope = mergeBox(globalPointEnvelope, { min: [...triple], max: [...triple] });
        }
      }
      if (!GEOMETRY_TYPES.has(type)) return;
      if (SKIP_IN_GEOMETRY.has(type)) skipFrame[id] = 1;
      indexById[id] = geometryIndex;
      offsets[geometryIndex] = referenceCursor;
      const flat = withoutStrings(record);

      // Mark only the points that really define an extent. A curve's or surface's own definition
      // point is not a boundary point: measured on a real export, 4 361 points sit between 100 mm and
      // 1.9 km from the vehicle because they are construction aids for near-planar faces, and
      // collecting them produced 20 km component boxes.
      // Member bodies, not the whole record: its own leading `#id` is a reference too, and taking
      // `allReferences(record)[0]` would mark the entity itself instead of its argument.
      if (type === 'VERTEX_POINT') {
        const refs = memberReferences(flat, MEMBER.vertexPoint);
        if (refs.length > 0) collectPoint[refs[0]] |= 1;
      } else if (type === 'POLYLINE') {
        for (const ref of memberReferences(flat, MEMBER.polyline)) collectPoint[ref] |= 1;
      } else if (type.startsWith('RATIONAL_B_SPLINE')) {
        // No rational evaluator or weight validation is implemented here. Never assume vertices or
        // an unrelated radius cover its bulge; mark each affected instance incomplete.
        rationalSplinesSkipped += 1;
        geometryIssues.set(id, 'rational-spline-not-evaluated');
      } else if (type.startsWith('B_SPLINE_CURVE') || type.startsWith('B_SPLINE_SURFACE')) {
        // Include every row of a surface's control net, allowing whitespace and complex records.
        // Do not discard distant control points: doing so can shrink the box below the curve.
        const refs = memberReferences(flat, '(?:^|[^A-Z0-9_])B_SPLINE_(?:CURVE|SURFACE)(?:_WITH_KNOTS)?\\(');
        for (const ref of refs) collectPoint[ref] |= 2;
        if (refs.length === 0) geometryIssues.set(id, 'spline-control-net-unresolved');
        if (flat.includes('RATIONAL_B_SPLINE')) geometryIssues.set(id, 'rational-spline-not-evaluated');
      } else if (RADIUS_TYPES.has(type)) {
        const numbers = (flat.replace(/#\d+/g, ' ').match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? [])
          .map(Number)
          .filter(Number.isFinite);
        if (numbers.length > 0) {
          const value = type === 'TOROIDAL_SURFACE' && numbers.length >= 2 ? numbers[0] + numbers[1] : Math.max(...numbers);
          if (value <= maxEnvelopeRadius) {
            radiusById[id] = value;
            const refs = memberReferences(flat, RADIUS_MEMBER.get(type));
            if (refs.length > 0) axisRefById[id] = refs[0];
          } else {
            oversizedRadii += 1;
            geometryIssues.set(id, 'radius-excluded-by-size-limit');
          }
        }
      } else if (type === 'AXIS2_PLACEMENT_3D') {
        const refs = memberReferences(flat, MEMBER.axisPlacement);
        if (refs.length > 0) axisLocationRef[id] = refs[0];
      }
      if (type.endsWith('SHAPE_REPRESENTATION')) isShapeRep[id] = 1;

      const re = /#(\d+)/g;
      let m = re.exec(flat);
      while (m !== null) {
        flatRefs[referenceCursor] = Number(m[1]);
        referenceCursor += 1;
        m = re.exec(flat);
      }
      geometryIndex += 1;
    });
    offsets[geometryCount] = referenceCursor;

    const stamp = new Int32Array(maxId + 1).fill(-1);
    const visitQueue = new Int32Array(geometryCount + 2);
    for (let i = 0; i < instances.length; i += 1) {
      const instance = instances[i];
      const issues = new Set();
      instance.boundsUsableForCompliance = false;
      const startId = instance.shapeRepresentation;
      if (startId === null || startId > maxId) {
        instance.boundsSource = 'none';
        instance.boundsStatus = 'unavailable';
        boundsWithoutGeometry += 1;
        continue;
      }
      // Seed the whole representation group, so the walk enters the solid rather than only the
      // placement representation that the shape definition names.
      let head = 0;
      let tail = 0;
      for (const seed of repGroupOf(startId)) {
        if (seed > maxId || stamp[seed] === i || tail >= visitQueue.length) continue;
        stamp[seed] = i;
        visitQueue[tail] = seed;
        tail += 1;
      }
      const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      let found = false;
      const inflations = [];
      while (head < tail) {
        const current = visitQueue[head];
        head += 1;
        if (geometryIssues.has(current)) issues.add(geometryIssues.get(current));
        const source = isPoint[current] === 1 ? collectPoint[current] : 0;
        if (source !== 0) {
          const x = coords[current * 3];
          const y = coords[current * 3 + 1];
          const z = coords[current * 3 + 2];
          if (x < box.min[0]) box.min[0] = x;
          if (y < box.min[1]) box.min[1] = y;
          if (z < box.min[2]) box.min[2] = z;
          if (x > box.max[0]) box.max[0] = x;
          if (y > box.max[1]) box.max[1] = y;
          if (z > box.max[2]) box.max[2] = z;
          found = true;
        }
        const radius = radiusById[current];
        if (radius > 0) {
          const originId = axisLocationRef[axisRefById[current]];
          if (originId > 0 && originId <= maxId && isPoint[originId] === 1) {
            // Deferred: whether this feature belongs to the part is decided after the walk, when the
            // part's own extent is known.
            if (inflations.length < 512) {
              inflations.push([coords[originId * 3], coords[originId * 3 + 1], coords[originId * 3 + 2], radius]);
            } else {
              issues.add('radius-feature-limit-reached');
            }
          } else {
            issues.add('radius-placement-unresolved');
          }
        }
        const index = indexById[current];
        if (index < 0) { issues.add('unsupported-or-missing-geometry-reference'); continue; }
        for (let r = offsets[index]; r < offsets[index + 1]; r += 1) {
          // The final reference in a shape representation is its context, not an item of geometry.
          if (isShapeRep[current] === 1 && r === offsets[index + 1] - 1) continue;
          const next = flatRefs[r];
          if (next < 1 || next > maxId) { issues.add('missing-geometry-reference'); continue; }
          if (stamp[next] === i) continue;
          if (skipFrame[next] === 1) continue;
          // A point listed directly by a shape representation is part of a point or wireframe model,
          // so it counts even though no vertex or spline introduces it.
          if (isShapeRep[current] === 1 && isPoint[next] === 1) collectPoint[next] |= 1;
          stamp[next] = i;
          if (tail < visitQueue.length) {
            visitQueue[tail] = next;
            tail += 1;
          } else {
            issues.add('geometry-traversal-limit-reached');
          }
        }
      }

      // Inflate with nearby circular features. The distance filter is only a heuristic; excluded
      // features mark this instance incomplete. Without other points, use the available feature.
      for (const [cx, cy, cz, radius] of inflations) {
        const centres = [cx, cy, cz];
        const nearby = !found || centres.every((centre, axis) => centre >= box.min[axis] - radius && centre <= box.max[axis] + radius);
        if (!nearby) {
          distantRadiiSkipped += 1;
          issues.add('distant-radius-excluded');
          continue;
        }
        for (let axis = 0; axis < 3; axis += 1) {
          if (centres[axis] - radius < box.min[axis]) box.min[axis] = centres[axis] - radius;
          if (centres[axis] + radius > box.max[axis]) box.max[axis] = centres[axis] + radius;
        }
        found = true;
      }

      if (found) {
        instance.localBounds = { min: [...box.min], max: [...box.max] };
        instance.boundsSource = 'geometry';
        if (instance.matrix !== null) {
          const m = [
            instance.matrix[0], instance.matrix[1], instance.matrix[2], instance.matrix[3],
            instance.matrix[4], instance.matrix[5], instance.matrix[6], instance.matrix[7],
            instance.matrix[8], instance.matrix[9], instance.matrix[10], instance.matrix[11],
            0, 0, 0, 1,
          ];
          instance.bounds = transformBox(m, box);
          envelope = mergeBox(envelope, instance.bounds);
        }
        // Some components still carry geometry that is larger than the part, which this session could
        // not trace further: construction geometry stored as model vertices or listed directly by the
        // shape representation. Rather than let a suspect number pass as a measurement, anything above
        // a stated size is flagged so it is never used silently.
        const extent = instance.bounds ?? instance.localBounds;
        if (extent) {
          const diagonal = Math.hypot(extent.max[0] - extent.min[0], extent.max[1] - extent.min[1], extent.max[2] - extent.min[2]);
          instance.boundsExtentMm = Number(diagonal.toFixed(1));
          if (diagonal > maxPlausibleExtent) {
            instance.boundsSuspect = true;
          }
        }
        boundsFromGeometry += 1;
      } else {
        // No usable extent was found; this does not establish that the component has no geometry.
        instance.boundsSource = 'none';
        boundsWithoutGeometry += 1;
      }
      if (instance.matrix === null) issues.add('assembly-placement-unresolved');
      instance.boundsWarnings = [...issues];
      instance.boundsIncomplete = issues.size > 0;
      if (issues.size > 0) {
        instance.boundsSuspect = true;
        boundsIncomplete += 1;
      }
      if (instance.boundsSuspect) boundsSuspect += 1;
      instance.boundsStatus = !instance.bounds ? 'unavailable' : issues.size > 0 ? 'incomplete' : instance.boundsSuspect ? 'suspect' : 'approximate';
    }

    // Subtree envelopes: a sub-assembly's own representation carries frames rather than solids, so
    // its extent is the union of its children. Parents always precede children in this list (the tree
    // is built breadth-first), so one reverse pass suffices.
    const childIndexes = instances.map(() => []);
    for (let i = 0; i < instances.length; i += 1) {
      const parent = instances[i].parentIndex;
      if (parent >= 0 && parent < instances.length) childIndexes[parent].push(i);
    }
    const subtree = new Array(instances.length).fill(null);
    for (let i = instances.length - 1; i >= 0; i -= 1) {
      let box = instances[i].bounds ?? null;
      for (const child of childIndexes[i]) box = mergeBox(box, subtree[child]);
      subtree[i] = box;
      if (box) {
        instances[i].subtreeBounds = box;
        instances[i].subtreeBoundsIncomplete = instances[i].boundsIncomplete || instances[i].boundsSuspect === true
          || (!instances[i].bounds && childIndexes[i].length === 0)
          || childIndexes[i].some((child) => instances[child].subtreeBoundsIncomplete || !subtree[child]);
        instances[i].subtreeBoundsUsableForCompliance = false;
        if (!instances[i].bounds) subtreeOnlyEnvelopes += 1;
      }
    }
  }

  return {
    instances,
    roots: roots.map((pd) => ({ id: pd, label: labelOf(pd) ?? `#${pd}`, children: (childrenOf.get(pd) ?? []).length })),
    envelope,
    globalPointEnvelope,
    stats: {
      fileBytes: size,
      entities,
      products: products.size,
      productDefinitions: productDefinitions.size,
      usageOccurrences: usageOccurrences.size,
      contexts: contexts.length,
      contextsWithoutUsage,
      placementsAssigned: framesByUsage.size,
      representationMatches,
      representationMismatches,
      instances: instances.length,
      maxDepth,
      unresolvedPlacements,
      boundsFromGeometry,
      boundsWithoutGeometry,
      subtreeOnlyEnvelopes,
      representationRelations: representationRelations.length,
      representationGroups: repGroupCache.size,
      oversizedRadiiSkipped: oversizedRadii,
      rationalSplinesSkipped,
      distantRadiiSkipped,
      distantControlPointsSkipped,
      boundsSuspect,
      boundsIncomplete,
      boundsUsableForCompliance: false,
      units: 'source coordinates; millimetres assumed, not converted',
      envelopeMemoryMB: Number((envelopeMemoryBytes / 1048576).toFixed(1)),
      boundsMethod,
      boundsValidation,
      truncated: instances.length >= maxInstances,
    },
  };
}
