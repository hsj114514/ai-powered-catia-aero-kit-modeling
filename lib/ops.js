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
 *     in the development environment (points, lines, offset planes, splines, multi-section
 *     lofts, joins, selection delete, SPA measurement, real/integer/string knowledge parameters).
 *     Calls that did not work here are not emitted at all: sketches, Pad, Extrude, Trim, Split,
 *     Extrapolate, Scaling and Published objects are absent by measurement, not by oversight.
 *
 * @module lib/ops
 */
import { vbsNum as N, vbsStr as S } from './vbs.js';
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
export function num(value, label, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number, got ${JSON.stringify(value)}`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}, got ${n}`);
  return n;
}

/**
 * Assert a finite number when present, or return the default.
 * @param value - candidate.
 * @param label - parameter name for the error.
 * @param fallback - value used when the parameter is absent.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the number.
 */
export function optNum(value, label, fallback, min = -1e6, max = 1e6) {
  if (value === undefined || value === null) return fallback;
  return num(value, label, min, max);
}

/** Emit the statements that create one closed/open section's points. */
function emitSection(section, points) {
  const lines = [`BeginSection ${S(section)}`];
  for (const p of points) lines.push(`AddSectionPt ${S(section)}, ${N(p[0])}, ${N(p[1])}, ${N(p[2])}`);
  return lines.join('\n');
}

/** Reject unknown pivot values instead of silently changing the modeled reference point. */
function checkedPivot(value) {
  if (value === undefined || value === 'le') return 'le';
  if (value === 'quarterChord') return 'quarterChord';
  throw new Error('pivot must be le or quarterChord');
}

/** Resolve a wing-like parameter block into per-station geometry. */
function layout(params) {
  const { loop } = resolveProfile(params);
  const stations = wingStations(params);
  const pivot = checkedPivot(params.pivot) === 'quarterChord' ? 0.25 : 0;
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
  const p = element.params;
  const { loop } = resolveProfile(p);
  const pivot = checkedPivot(p.pivot);
  const points = section3d(loop, {
    chord: num(p.chord, 'chord', 0.1, 100000),
    aoaDeg: optNum(p.aoaDeg, 'aoaDeg', 0, -180, 180),
    twistDeg: optNum(p.twistDeg, 'twistDeg', 0, -180, 180),
    pivot,
    origin: p.origin ?? [0, 0, 0],
    thicknessScale: optNum(p.thicknessScale, 'thicknessScale', 1, 0.02, 5),
  });
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

/** Resolve a flap's stations from its parent wing element and its own placement rules. */
function flapLayout(element, parent) {
  if (!parent) throw new Error(`flap ${element.id} needs its parent element`);
  const parentStations = layout(parent.params);
  const { loop } = resolveProfile(element.params);
  const p = element.params;
  const chordRatio = num(p.chordRatio ?? 0.3, 'chordRatio', 0.02, 1.5);
  const deflection = optNum(p.deflectionDeg, 'deflectionDeg', 0, -90, 90);
  const gapMode = p.gapPercent !== undefined ? 'percent' : 'mm';
  const gapValue = gapMode === 'percent' ? num(p.gapPercent, 'gapPercent', 0, 100) : num(p.gap ?? 2, 'gap', 0, 5000);
  const overlapMode = p.overlapPercent !== undefined ? 'percent' : 'mm';
  const overlapValue = overlapMode === 'percent'
    ? num(p.overlapPercent, 'overlapPercent', -100, 100)
    : num(p.overlap ?? 0, 'overlap', -5000, 5000);
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
    return {
      ...station,
      chord: parentChord * chordRatio,
      aoaDeg: station.aoaDeg + deflection,
      origin,
    };
  });
}

/** Build the fragment for a flap element. */
function flapElement(element, context) {
  const parent = context.parent;
  const stations = flapLayout(element, parent);
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

/** Build the fragment for a flat endplate: a thin slab lofted from two identical outlines. */
function endplateElement(element) {
  const p = element.params;
  const thickness = num(p.thickness ?? 2, 'thickness', 0.2, 200);
  const z = num(p.z ?? 0, 'z', -100000, 100000);
  const scale = optNum(p.scale, 'scale', 1, 0.02, 20);
  let outline;
  if (Array.isArray(p.outlinePoints) && p.outlinePoints.length >= 3) {
    if (p.outlinePoints.length > 5000) throw new Error('outlinePoints must contain at most 5000 points');
    outline = p.outlinePoints.map(([x, y]) => [Number(x) * scale, Number(y) * scale]);
  } else {
    const chord = num(p.chord ?? 300, 'chord', 1, 100000);
    const height = num(p.height ?? 120, 'height', 1, 100000);
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
  const front = outline.map(([x, y]) => [x, y, z]);
  const back = outline.map(([x, y]) => [x, y, z + thickness]);
  return contourLoft(element, [front, back], GEOSET.plates);
}

/** Build the fragment for a simple diffuser: a lofted box that grows from inlet to outlet. */
function diffuserElement(element) {
  const p = element.params;
  const length = num(p.length ?? 400, 'length', 1, 100000);
  const stations = Math.max(2, Math.min(12, Math.trunc(p.stations ?? 3)));
  const read = (block, label) => {
    const height = num(block?.height, `${label}.height`, 1, 100000);
    const halfWidth = num(block?.halfWidth, `${label}.halfWidth`, 1, 100000);
    const y = num(block?.y ?? 0, `${label}.y`, -100000, 100000);
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
  return contourLoft(element, contours, GEOSET.plates);
}

/** Build the fragment for a free-form spline through explicit points. */
function guideCurveElement(element) {
  const p = element.params;
  if (!Array.isArray(p.points) || p.points.length < 2) {
    throw new Error('guide_curve needs at least two [x, y, z] points');
  }
  if (p.points.length > 2000) throw new Error('points must contain at most 2000 points');
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
  if (parent.kind !== 'wing') throw new Error(`flap ${element.id} needs a wing parent, got ${parent.kind}`);
  return { parent };
}

/**
 * Compute the axis-aligned bounds of an element from its parameters, without CATIA.
 * @param element - the element.
 * @param elements - the element map, for dependent kinds.
 * @returns `{ min, max }` in millimetres, or null when the kind carries no derivable geometry.
 */
export function elementBounds(element, elements) {
  const points = [];
  try {
    const context = elementContext(element, elements);
    switch (element.kind) {
      case 'point':
        points.push([element.params.x, element.params.y, element.params.z]);
        break;
      case 'line':
        points.push(
          [element.params.x1, element.params.y1, element.params.z1],
          [element.params.x2, element.params.y2, element.params.z2],
        );
        break;
      case 'guide_curve':
        if (element.params.points.length > 2000) throw new Error('points must contain at most 2000 points');
        points.push(...element.params.points.map((p) => [Number(p[0]), Number(p[1]), Number(p[2])]));
        break;
      case 'section': {
        const { loop } = resolveProfile(element.params);
        points.push(...section3d(loop, {
          chord: Number(element.params.chord),
          aoaDeg: Number(element.params.aoaDeg ?? 0),
          twistDeg: Number(element.params.twistDeg ?? 0),
          pivot: element.params.pivot,
          origin: element.params.origin ?? [0, 0, 0],
          thicknessScale: Number(element.params.thicknessScale ?? 1),
        }));
        break;
      }
      case 'wing':
        for (const station of layout(element.params)) points.push(...station.points);
        break;
      case 'flap':
        for (const station of flapLayout(element, context.parent)) {
          points.push(...section3d(resolveProfile(element.params).loop, {
            chord: station.chord,
            aoaDeg: station.aoaDeg,
            origin: station.origin,
            thicknessScale: Number(element.params.thicknessScale ?? 1),
          }));
        }
        break;
      case 'endplate': {
        if (Array.isArray(element.params.outlinePoints) && element.params.outlinePoints.length > 5000) {
          throw new Error('outlinePoints must contain at most 5000 points');
        }
        const thickness = Number(element.params.thickness ?? 2);
        const z = Number(element.params.z ?? 0);
        const outline = Array.isArray(element.params.outlinePoints) && element.params.outlinePoints.length >= 3
          ? element.params.outlinePoints
          : [[0, 0], [Number(element.params.chord ?? 300) * 0.92, 0], [Number(element.params.chord ?? 300), Number(element.params.height ?? 120)], [0, Number(element.params.height ?? 120)]];
        const scale = Number(element.params.scale ?? 1);
        for (const [x, y] of outline) {
          points.push([Number(x) * scale, Number(y) * scale, z]);
          points.push([Number(x) * scale, Number(y) * scale, z + thickness]);
        }
        break;
      }
      case 'diffuser': {
        const { inlet, outlet, length, stations, xStart } = element.params;
        const n = Math.max(2, Math.min(12, Math.trunc(stations ?? 3)));
        for (let i = 0; i < n; i += 1) {
          const t = i / (n - 1);
          const x = Number(xStart ?? 0) + Number(length) * t;
          const height = Number(inlet.height) + (Number(outlet.height) - Number(inlet.height)) * t;
          const halfWidth = Number(inlet.halfWidth) + (Number(outlet.halfWidth) - Number(inlet.halfWidth)) * t;
          const y = Number(inlet.y ?? 0) + (Number(outlet.y ?? 0) - Number(inlet.y ?? 0)) * t;
          points.push([x, y, -halfWidth], [x, y + height, -halfWidth], [x, y + height, halfWidth], [x, y, halfWidth]);
        }
        break;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
  const usable = points.filter((p) => p.every((v) => Number.isFinite(Number(v))));
  if (usable.length === 0) return null;
  const min = [0, 1, 2].map((axis) => Math.min(...usable.map((p) => Number(p[axis]))));
  const max = [0, 1, 2].map((axis) => Math.max(...usable.map((p) => Number(p[axis]))));
  return { min, max };
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
  if (params.flaps !== undefined && !Array.isArray(params.flaps)) {
    throw new Error('flaps must be an array');
  }
  const flaps = Array.isArray(params.flaps) ? params.flaps : [];
  if (flaps.length > 8) throw new Error('at most 8 flap elements per multi-element wing');
  const effectiveProfilePointCount = flaps.reduce((total, flap) => {
    const coordinates = flap?.coordinates ?? params.coordinates;
    return total + (Array.isArray(coordinates) ? coordinates.length : 0);
  }, Array.isArray(params.coordinates) ? params.coordinates.length : 0);
  if (effectiveProfilePointCount > 5000) {
    throw new Error('profile coordinates across the wing and its flaps must total at most 5000 points');
  }
  flaps.forEach((flap, index) => {
    elements.push({
      id: `${id}__flap${index + 1}`,
      kind: 'flap',
      params: {
        parentId: id,
        naca: flap.naca ?? params.naca,
        coordinates: flap.coordinates ?? params.coordinates,
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
