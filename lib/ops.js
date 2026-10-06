// SPDX-License-Identifier: GPL-3.0-only
/**
 * The whitelisted element library.
 *
 * Every design element is described by `(kind, params)` and knows how to emit the VBScript that
 * builds it. Two properties matter:
 *
 *  1. Determinism. A fragment depends only on its normalized params (plus, for a dependent
 *     element such as a flap, the resolved params of its parent). Replaying the ledger therefore
 *     reproduces the model, which is what makes versions, rollback and audit meaningful.
 *  2. Verified calls only. The fragments use the CATIA automation calls that were confirmed
 *     against this machine's CATIA V5-6R2020 (points, lines, offset planes, splines, multi-section
 *     lofts, joins, selection delete, SPA measurement, real/integer/string knowledge parameters).
 *     Calls that did not work here are not emitted at all: sketches, Pad, Extrude, Trim, Split,
 *     Extrapolate, Scaling and Published objects are absent by measurement, not by oversight.
 *
 * @module lib/ops
 */
import { vbsNum as N, vbsStr as S } from './vbs.js';
import { finiteNumber, optionalNumber, integerOption, vector } from './validation.js';
import { resolveProfile, section3d, stationPoints, wingStations } from './airfoil.js';

/** Geosets used to keep agent-created geometry separated from anything a human made. */
export const GEOSET = {
  reference: 'Aero_Reference',
  sections: 'Aero_Sections',
  contours: 'Aero_Contours',
  wings: 'Aero_Wings',
  flaps: 'Aero_Flaps',
  plates: 'Aero_Endplates',
};

/** Risk level per element kind; the tool layer reports these and the bridge enforces them. */
export const KIND_LEVEL = {
  point: 1,
  line: 1,
  plane: 1,
  guide_curve: 1,
  section: 1,
  wing: 1,
  flap: 1,
  endplate: 1,
  diffuser: 1,
};

/** Kinds whose parameters may be changed after creation, with the whitelisted keys. */
export const EDITABLE = {
  wing: ['chordRoot', 'chordTip', 'aoaRoot', 'twist', 'span', 'zStart', 'sweepDeg', 'dihedralDeg', 'stations', 'thicknessScale', 'xOffset', 'yOffset'],
  flap: ['chordRatio', 'deflectionDeg', 'gap', 'overlap', 'gapPercent', 'overlapPercent'],
  endplate: ['thickness', 'z', 'scale'],
  diffuser: ['inlet', 'outlet', 'length', 'stations'],
  section: ['chord', 'aoaDeg', 'twistDeg', 'pivot', 'origin', 'thicknessScale'],
};

/**
 * Assert a finite number inside an inclusive range.
 * @param value - candidate.
 * @param label - parameter name for the error.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the number.
 */
export const num = finiteNumber;
export const optNum = optionalNumber;

/** Emit the statements that create one closed/open section's points. */
function emitSection(section, points) {
  const lines = [`BeginSection ${S(section)}`];
  for (const p of points) lines.push(`AddSectionPt ${S(section)}, ${N(p[0])}, ${N(p[1])}, ${N(p[2])}`);
  return lines.join('\n');
}

/** Resolve a wing-like parameter block into per-station geometry. */
function layout(params) {
  const { loop } = resolveProfile(params);
  const stations = wingStations(params);
  const pivot = params.pivot === 'quarterChord' ? 0.25 : 0;
  return stations.map((station) => {
    const theta = (-station.aoaDeg * Math.PI) / 180;
    const chordDir = [Math.cos(theta), Math.sin(theta)];
    const normalDir = [-Math.sin(theta), Math.cos(theta)];
    const arm = station.chord * (1 - pivot);
    return {
      ...station,
      points: stationPoints(loop, station),
      chordDir,
      normalDir,
      trailingEdge: [
        station.origin[0] + arm * chordDir[0],
        station.origin[1] + arm * chordDir[1],
      ],
    };
  });
}

/** Build the fragment for a single closed profile (airfoil section). */
function sectionElement(element) {
  const points = elementGeometry(element).contours[0];
  return [
    `BeginOpenSet ${S(GEOSET.sections)}`,
    emitSection(element.id, points),
    `MakeSpline ${S(element.id)}, 1, ${S(element.id)}`,
    `UpdateNow ${S(element.id + ' update')}`,
  ].join('\n');
}

/** Build the fragment for a multi-section wing surface. */
function wingElement(element) {
  const p = element.params;
  const stations = layout(p);
  const lines = [`BeginOpenSet ${S(GEOSET.sections)}`];
  stations.forEach((station, index) => {
    lines.push(emitSection(`${element.id}__s${index + 1}`, station.points));
    lines.push(`MakeSpline ${S(`${element.id}__s${index + 1}`)}, 1, ""`);
  });
  lines.push(`UpdateNow ${S(`${element.id} sections`)}`);
  lines.push(`BeginOpenSet ${S(GEOSET.wings)}`);
  const sectionList = stations.map((_, index) => `${element.id}__s${index + 1}`).join('|');
  lines.push(`MakeLoft ${S(element.id)}, ${S(sectionList)}`);
  lines.push(`UpdateNow ${S(element.id + ' update')}`);
  return lines.join('\n');
}

/**
 * Resolve a flap's stations from its parent element and its own placement rules.
 *
 * The parent may be a wing **or another flap**. That is what makes a serial multi-element slot
 * expressible: the second flap's gap and overlap are then measured from the first flap's trailing
 * edge instead of from the wing's. Each station carries its own chord direction, normal and trailing
 * edge — without that, a child would silently anchor to the wing at the top of the chain, which is
 * exactly what produced parallel rather than serial flaps.
 *
 * @param element - the flap element.
 * @param context - `{ parent, elements }`; the chain is walked through `elements`.
 * @returns one geometry record per spanwise station.
 */
function flapLayout(element, context) {
  const elements = context?.elements ?? {};
  const parent = context?.parent ?? (element.params?.parentId ? elements[element.params.parentId] : undefined);
  if (!parent) throw new Error(`flap ${element.id} refers to missing parent element ${element.params?.parentId}`);
  const visiting = context?.visiting ?? new Set([element.id]);
  if (visiting.has(parent.id)) throw new Error('cyclic flap dependency: ' + parent.id);
  const parentStations = stationsOf(parent, elements, new Set([...visiting, parent.id]));
  resolveProfile(element.params);
  const p = element.params;
  const chordRatio = optNum(p.chordRatio, 'chordRatio', 0.3, 0.02, 1.5);
  const deflection = optNum(p.deflectionDeg, 'deflectionDeg', 0, -90, 90);
  const gapMode = p.gapPercent !== undefined ? 'percent' : 'mm';
  const gapValue = gapMode === 'percent' ? num(p.gapPercent, 'gapPercent', 0, 100) : optNum(p.gap, 'gap', 2, 0, 5000);
  const overlapMode = p.overlapPercent !== undefined ? 'percent' : 'mm';
  const overlapValue = overlapMode === 'percent'
    ? num(p.overlapPercent, 'overlapPercent', -100, 100)
    : optNum(p.overlap, 'overlap', 0, -5000, 5000);
  return parentStations.map((station) => {
    const parentChord = station.chord;
    const gap = gapMode === 'percent' ? (gapValue / 100) * parentChord : gapValue;
    const overlap = overlapMode === 'percent' ? (overlapValue / 100) * parentChord : overlapValue;
    // Gap and overlap are measured from the parent's trailing edge: overlap moves the flap's
    // leading edge forward along the parent chord line, gap moves it down along the chord normal.
    const origin = [
      station.trailingEdge[0] - overlap * station.chordDir[0] - gap * station.normalDir[0],
      station.trailingEdge[1] - overlap * station.chordDir[1] - gap * station.normalDir[1],
      station.z,
    ];
    // This flap's own frame, so a further flap can be chained onto it.
    const chord = parentChord * chordRatio;
    const aoaDeg = station.aoaDeg + deflection;
    const theta = (-aoaDeg * Math.PI) / 180;
    const chordDir = [Math.cos(theta), Math.sin(theta)];
    const normalDir = [-Math.sin(theta), Math.cos(theta)];
    return {
      z: station.z,
      chord,
      aoaDeg,
      origin,
      chordDir,
      normalDir,
      trailingEdge: [origin[0] + chord * chordDir[0], origin[1] + chord * chordDir[1]],
    };
  });
}

/** Per-station geometry for any element allowed to act as a flap parent. */
function stationsOf(element, elements, visiting) {
  if (element.kind === 'wing') return layout(element.params);
  if (element.kind === 'flap') return flapLayout(element, { elements, visiting });
  throw new Error(`element ${element.id} of kind ${element.kind} cannot act as a flap parent`);
}

/** Build the fragment for a flap element. */
function flapElement(element, context) {
  const stations = flapLayout(element, context);
  const { loop } = resolveProfile(element.params);
  const thicknessScale = optNum(element.params.thicknessScale, 'thicknessScale', 1, 0.02, 5);
  const lines = [`BeginOpenSet ${S(GEOSET.sections)}`];
  stations.forEach((station, index) => {
    const points = section3d(loop, {
      chord: station.chord,
      aoaDeg: station.aoaDeg,
      origin: station.origin,
      thicknessScale,
    });
    lines.push(emitSection(`${element.id}__s${index + 1}`, points));
    lines.push(`MakeSpline ${S(`${element.id}__s${index + 1}`)}, 1, ""`);
  });
  lines.push(`UpdateNow ${S(`${element.id} sections`)}`);
  lines.push(`BeginOpenSet ${S(GEOSET.flaps)}`);
  const sectionList = stations.map((_, index) => `${element.id}__s${index + 1}`).join('|');
  lines.push(`MakeLoft ${S(element.id)}, ${S(sectionList)}`);
  lines.push(`UpdateNow ${S(element.id + ' update')}`);
  return lines.join('\n');
}

/** Build a lofted element from explicit contours of equal point count. */
function contourLoft(element, contours, geoset) {
  const lines = [`BeginOpenSet ${S(GEOSET.contours)}`];
  contours.forEach((contour, index) => {
    lines.push(emitSection(`${element.id}__c${index + 1}`, contour));
    lines.push(`MakeSpline ${S(`${element.id}__c${index + 1}`)}, 1, ""`);
  });
  lines.push(`UpdateNow ${S(`${element.id} sections`)}`);
  lines.push(`BeginOpenSet ${S(geoset)}`);
  const list = contours.map((_, index) => `${element.id}__c${index + 1}`).join('|');
  lines.push(`MakeLoft ${S(element.id)}, ${S(list)}`);
  lines.push(`UpdateNow ${S(element.id + ' update')}`);
  return lines.join('\n');
}

/** A finite, simple outline is required before asking CATIA to interpolate the slab's contours. */
function plateOutline(points) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 256) throw new Error('outlinePoints must have 3..256 pairs');
  const outline = points.map((point, i) => vector(point, 2, `outlinePoints[${i}]`));
  if (outline[0].every((v, i) => v === outline.at(-1)[i])) outline.pop();
  if (outline.length < 3) throw new Error('outline needs three distinct vertices');
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const between = (a, b, c) => Math.abs(cross(a, b, c)) < 1e-9 && [0, 1].every((i) => c[i] >= Math.min(a[i], b[i]) && c[i] <= Math.max(a[i], b[i]));
  const intersects = (a, b, c, d) => cross(a,b,c) * cross(a,b,d) < 0 && cross(c,d,a) * cross(c,d,b) < 0 || between(a,b,c) || between(a,b,d) || between(c,d,a) || between(c,d,b);
  let area = 0;
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) throw new Error('outline contains a zero-length edge');
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < outline.length; j += 1) {
      if (i === 0 && j === outline.length - 1) continue;
      if (intersects(a, b, outline[j], outline[(j + 1) % outline.length])) throw new Error('outline self-intersects');
    }
  }
  if (Math.abs(area) < 1e-9) throw new Error('outline has zero area');
  return outline;
}

/** Build the fragment for a flat endplate: a thin slab lofted from two identical outlines. */
function endplateContours(element) {
  const p = element.params;
  const thickness = optNum(p.thickness, 'thickness', 2, 0.2, 200);
  const z = optNum(p.z, 'z', 0, -100000, 100000);
  const scale = optNum(p.scale, 'scale', 1, 0.02, 20);
  let outline;
  if (p.outlinePoints !== undefined) {
    outline = plateOutline(p.outlinePoints).map((point) => point.map((v) => v * scale));
  } else {
    const chord = optNum(p.chord, 'chord', 300, 1, 100000);
    const height = optNum(p.height, 'height', 120, 1, 100000);
    const sweep = ((optNum(p.sweepDeg, 'sweepDeg', 0, -80, 80)) * Math.PI) / 180;
    const topBack = chord * 0.92;
    const bottomBack = chord - height * Math.tan(sweep);
    outline = [
      [0, 0],
      [topBack, 0],
      [bottomBack, height],
      [0, height],
    ].map(([x, y]) => [x * scale, y * scale]);
  }
  if (!outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
    throw new Error('outlinePoints must contain finite [x, y] pairs');
  }
  outline = plateOutline(outline);
  const front = outline.map(([x, y]) => [x, y, z]);
  const back = outline.map(([x, y]) => [x, y, z + thickness]);
  return [front, back];
}

function endplateElement(element) {
  return contourLoft(element, endplateContours(element), GEOSET.plates);
}

/** Build the fragment for a simple diffuser: a lofted box that grows from inlet to outlet. */
function diffuserContours(element) {
  const p = element.params;
  const length = optNum(p.length, 'length', 400, 1, 100000);
  const stations = integerOption(p.stations, 3, 2, 12, 'stations');
  const read = (block, label) => {
    const height = num(block?.height, `${label}.height`, 1, 100000);
    const halfWidth = num(block?.halfWidth, `${label}.halfWidth`, 1, 100000);
    const y = optNum(block?.y, `${label}.y`, 0, -100000, 100000);
    return { height, halfWidth, y };
  };
  const inlet = read(p.inlet, 'inlet');
  const outlet = read(p.outlet, 'outlet');
  const xStart = optNum(p.xStart, 'xStart', 0, -100000, 100000);
  const corners = (cx, height, halfWidth, y) => [
    [cx, y, -halfWidth],
    [cx, y + height, -halfWidth],
    [cx, y + height, halfWidth],
    [cx, y, halfWidth],
  ];
  const contours = [];
  for (let i = 0; i < stations; i += 1) {
    const t = i / (stations - 1);
    const cx = xStart + length * t;
    const height = inlet.height + (outlet.height - inlet.height) * t;
    const halfWidth = inlet.halfWidth + (outlet.halfWidth - inlet.halfWidth) * t;
    const y = inlet.y + (outlet.y - inlet.y) * t;
    contours.push(corners(cx, height, halfWidth, y));
  }
  return contours;
}

function diffuserElement(element) {
  return contourLoft(element, diffuserContours(element), GEOSET.plates);
}

/** Build the fragment for a free-form spline through explicit points. */
function guideCurveElement(element) {
  const p = element.params;
  if (!Array.isArray(p.points) || p.points.length < 2) {
    throw new Error('guide_curve needs at least two [x, y, z] points');
  }
  const points = p.points.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`points[${index}] must be [x, y, z]`);
    return [num(entry[0], `points[${index}][0]`, -1e6, 1e6), num(entry[1], `points[${index}][1]`, -1e6, 1e6), num(entry[2], `points[${index}][2]`, -1e6, 1e6)];
  });
  return [
    `BeginOpenSet ${S(GEOSET.reference)}`,
    emitSection(element.id, points),
    `MakeSpline ${S(element.id)}, ${p.closed ? 1 : 0}, ${S(element.id)}`,
    `UpdateNow ${S(element.id + ' update')}`,
  ].join('\n');
}

/** Build the fragment for a single reference point. */
function pointElement(element) {
  const p = element.params;
  return [
    `BeginOpenSet ${S(GEOSET.reference)}`,
    `MakePointFeature ${S(element.id)}, ${N(num(p.x, 'x', -1e6, 1e6))}, ${N(num(p.y, 'y', -1e6, 1e6))}, ${N(num(p.z, 'z', -1e6, 1e6))}`,
    `UpdateNow ${S(element.id + ' update')}`,
  ].join('\n');
}

/** Build the fragment for a single reference line. */
function lineElement(element) {
  const p = element.params;
  const v = (key) => N(num(p[key], key, -1e6, 1e6));
  return [
    `BeginOpenSet ${S(GEOSET.reference)}`,
    `MakeLine ${S(element.id)}, ${v('x1')}, ${v('y1')}, ${v('z1')}, ${v('x2')}, ${v('y2')}, ${v('z2')}`,
    `UpdateNow ${S(element.id + ' update')}`,
  ].join('\n');
}

/** Build the fragment for a reference plane offset from a principal plane. */
function planeElement(element) {
  const p = element.params;
  const base = String(p.base ?? 'XY').toUpperCase();
  if (!['XY', 'YZ', 'ZX'].includes(base)) throw new Error('base must be XY, YZ or ZX');
  return [
    `BeginOpenSet ${S(GEOSET.reference)}`,
    `MakePlaneOffset ${S(element.id)}, ${S(base)}, ${N(num(p.offset, 'offset', -1e6, 1e6))}, ${p.reverse ? 'True' : 'False'}`,
    `UpdateNow ${S(element.id + ' update')}`,
  ].join('\n');
}

/**
 * Emit the VBScript fragment that builds one element.
 * @param element - `{ id, kind, params }`.
 * @param context - resolved dependencies, e.g. `{ parent }` for a flap.
 * @returns the script fragment.
 */
export function elementFragment(element, context = {}) {
  switch (element.kind) {
    case 'point': return pointElement(element);
    case 'line': return lineElement(element);
    case 'plane': return planeElement(element);
    case 'guide_curve': return guideCurveElement(element);
    case 'section': return sectionElement(element);
    case 'wing': return wingElement(element);
    case 'flap': return flapElement(element, context);
    case 'endplate': return endplateElement(element);
    case 'diffuser': return diffuserElement(element);
    default: throw new Error(`unknown element kind: ${element.kind}`);
  }
}

/**
 * Resolve the parent element a dependent element needs.
 * @param element - the element being built.
 * @param elements - the full element map.
 * @returns `{ parent }` for a flap, `{}` otherwise.
 */
export function elementContext(element, elements) {
  if (element.kind !== 'flap') return {};
  const parentId = element.params?.parentId;
  const parent = parentId ? elements[parentId] : undefined;
  if (!parent) throw new Error(`flap ${element.id} refers to missing parent element ${parentId}`);
  if (parent.kind !== 'wing' && parent.kind !== 'flap') {
    throw new Error(`flap ${element.id} needs a wing or flap parent, got ${parent.kind}`);
  }
  // `elements` travels with the context so a chain of flaps can be walked when resolving stations.
  return { parent, elements };
}

/** Rebuild in dependency order even after importing a reordered ledger; reject cycles explicitly. */
export function orderedElements(elements) {
  const active = new Set();
  const done = new Set();
  const ordered = [];
  const visit = (element, depth = 0) => {
    if (depth > 64) throw new Error('dependency chain exceeds 64 elements');
    if (active.has(element.id)) throw new Error('cyclic dependency: ' + element.id);
    if (done.has(element.id)) return;
    active.add(element.id);
    if (element.kind === 'flap') visit(elementContext(element, elements).parent, depth + 1);
    active.delete(element.id);
    done.add(element.id);
    ordered.push(element);
  };
  for (const [id, element] of Object.entries(elements)) {
    if (element.id !== id) throw new Error('ledger element ID does not match its key: ' + id);
    visit(element);
  }
  return ordered;
}

/**
 * Compute the axis-aligned bounds of an element from its parameters, without CATIA.
 * @param element - the element.
 * @param elements - the element map, for dependent kinds.
 * @returns `{ min, max }` in millimetres, or null when the kind carries no derivable geometry.
 */
export function elementGeometry(element, elements = {}) {
  const p = element.params;
  let contours;
  let exact = false;
  switch (element.kind) {
    case 'point': contours = [[vector([p.x, p.y, p.z], 3, 'point')]]; exact = true; break;
    case 'line': contours = [[vector([p.x1,p.y1,p.z1],3,'line start'), vector([p.x2,p.y2,p.z2],3,'line end')]]; exact = true; break;
    case 'guide_curve': contours = [p.points.map((point,i) => vector(point,3,'points['+i+']'))]; break;
    case 'section': contours = [section3d(resolveProfile(p).loop, p)]; break;
    case 'wing': contours = layout(p).map((station) => station.points); break;
    case 'flap': {
      const { loop } = resolveProfile(p);
      const thicknessScale = optNum(p.thicknessScale, 'thicknessScale', 1, 0.02, 5);
      contours = flapLayout(element, elementContext(element, elements)).map((station) => section3d(loop, { ...station, thicknessScale }));
      break;
    }
    case 'endplate': contours = endplateContours(element); break;
    case 'diffuser': contours = diffuserContours(element); break;
    default: return null;
  }
  if (contours.length === 0 || contours.some((c) => c.length === 0 || c.some((point) => point.length !== 3 || point.some((v) => typeof v !== 'number' || !Number.isFinite(v))))) throw new Error('element geometry must be complete and finite');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const contour of contours) for (const point of contour) for (let axis = 0; axis < 3; axis += 1) {
    min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]);
  }
  return { contours, bounds: { min, max }, quality: exact ? 'exact-linear' : 'sampled-input', boundsCertified: exact };
}

export function elementBounds(element, elements) {
  try { return elementGeometry(element, elements)?.bounds ?? null; } catch { return null; }
}

/**
 * Expand a compound request into the elements it creates.
 * @param kind - the requested element kind.
 * @param id - the base element id.
 * @param params - the request parameters.
 * @returns the elements to record and build.
 */
export function expandRequest(kind, id, params) {
  if (kind !== 'multi_element_wing') {
    return [{ id, kind, params }];
  }
  const elements = [{
    id,
    kind: 'wing',
    params: { ...params, naca: params.naca, coordinates: params.coordinates },
  }];
  const flaps = Array.isArray(params.flaps) ? params.flaps : [];
  if (flaps.length > 8) throw new Error('at most 8 flap elements per multi-element wing');
  flaps.forEach((flap, index) => {
    elements.push({
      id: `${id}__flap${index + 1}`,
      kind: 'flap',
      params: {
        parentId: index === 0 ? id : `${id}__flap${index}`,
        naca: flap.coordinates !== undefined ? undefined : (flap.naca ?? params.naca),
        coordinates: flap.naca !== undefined ? undefined : (flap.coordinates ?? (flap.naca === undefined ? params.coordinates : undefined)),
        chordRatio: flap.chordRatio,
        deflectionDeg: flap.deflectionDeg,
        gap: flap.gap,
        overlap: flap.overlap,
        gapPercent: flap.gapPercent,
        overlapPercent: flap.overlapPercent,
        thicknessScale: flap.thicknessScale ?? params.thicknessScale,
      },
    });
  });
  return elements;
}
