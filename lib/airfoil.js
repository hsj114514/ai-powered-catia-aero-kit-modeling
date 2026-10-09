// SPDX-License-Identifier: GPL-3.0-only
/**
 * Airfoil geometry: profile generation, coordinate parsing, and 3D section placement.
 *
 * This module is pure arithmetic and deliberately contains no CATIA knowledge, so the aero math
 * can be reasoned about and tested without a CATIA session. No airfoil coordinate data is
 * bundled: NACA 4-digit profiles are generated analytically, and real-world profiles (S1223 and
 * friends) must come from the user's own coordinate file or from coordinates supplied in the
 * request. Fabricating coordinates for a named aerofoil would silently corrupt the design.
 *
 * Axis convention used throughout the plugin (documented for the user in the tool descriptions):
 *   +X aft (chordwise, leading edge at x = 0), +Y up (thickness), +Z outboard (span).
 *
 * @module lib/airfoil
 */

import { finiteNumber, optionalNumber, integerOption, vector } from './validation.js';

/**
 * NACA 4-digit thickness and camber model.
 * @param code - four digits, e.g. "2412" or "0012".
 * @returns the parsed camber `m`, camber position `p`, and thickness `t` as fractions of chord.
 */
export function parseNaca4(code) {
  const text = String(code).trim();
  if (!/^\d{4}$/.test(text)) {
    throw new Error(`NACA 4-digit code must be four digits, got "${text}"`);
  }
  const m = Number(text[0]) / 100;
  const p = Number(text[1]) / 10;
  const t = Number(text.slice(2)) / 100;
  if (t === 0) throw new Error('an airfoil needs nonzero thickness');
  if (m > 0 && p === 0) throw new Error(`NACA ${text}: a cambered profile needs a non-zero camber position`);
  return { m, p, t };
}

/** Normalize a bounded integer option and reject malformed values explicitly. */
const boundedInteger = (value, fallback, min, max, label) => integerOption(value, fallback, min, max, label);

/**
 * Generate a NACA 4-digit profile as a closed loop of normalized coordinates.
 *
 * The trailing edge is left slightly blunt by default. A mathematically sharp (zero-thickness)
 * trailing edge makes the upper and lower surfaces coincide exactly, and CATIA's multi-section
 * loft then refuses to update on such a section — measured on CATIA V5-6R2020: a section whose
 * trailing-edge ordinates are both 0.000000 fails its loft update, while one at ±0.00126
 * (0.25 mm on a 300 mm chord) lofts normally. Real coordinate files carry the same small finite
 * thickness, so the default matches how an airfoil is actually defined.
 *
 * @param code - four digits, e.g. "2412".
 * @param options - `count` points per surface (default 40), and `closedTrailingEdge` to force the
 *   sharp trailing edge that this CATIA build cannot loft.
 * @returns loop points in Selig order: trailing edge over the upper surface to the leading edge,
 *   then back along the lower surface, retaining both finite-thickness trailing-edge points.
 */
export function naca4Loop(code, options = {}) {
  const count = boundedInteger(options.count, 40, 8, 200, 'count');
  const closeTe = options.closedTrailingEdge === true;
  const thicknessCoefficient = closeTe ? 0.1036 : 0.1015;
  const { m, p, t } = parseNaca4(code);

  const surface = (x) => {
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - thicknessCoefficient * x ** 4);
    let yc = 0;
    let dyc = 0;
    if (m > 0) {
      if (x < p) {
        yc = (m / p ** 2) * (2 * p * x - x ** 2);
        dyc = (2 * m) / p ** 2 * (p - x);
      } else {
        yc = (m / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x ** 2);
        dyc = (2 * m) / (1 - p) ** 2 * (p - x);
      }
    }
    const theta = Math.atan(dyc);
    return {
      upper: [x - yt * Math.sin(theta), yc + yt * Math.cos(theta)],
      lower: [x + yt * Math.sin(theta), yc - yt * Math.cos(theta)],
    };
  };

  const upper = [];
  const lower = [];
  for (let i = 0; i < count; i += 1) {
    const theta = (Math.PI * i) / (count - 1);
    const x = 0.5 * (1 - Math.cos(theta));
    const pair = surface(x);
    upper.push(pair.upper);
    lower.push(pair.lower);
  }
  // Upper runs trailing edge (x=1) to leading edge (x=0); the lower surface then returns to the
  // trailing edge, skipping the shared leading edge point and the closing trailing edge point.
  const loop = [...upper.reverse()];
  for (let i = 1; i < count; i += 1) {
    if (closeTe && i === count - 1) continue;
    loop.push(lower[i]);
  }
  return loop;
}

/**
 * Parse an airfoil coordinate file in Selig (`.dat`) or Lednicer format.
 *
 * Both formats run from the trailing edge to the leading edge and back, and differ only in which
 * surface comes first, so the surfaces are identified geometrically (the upper surface has the
 * larger mean ordinate) instead of trusting a format label.
 *
 * @param text - the file contents.
 * @returns `{ name, points, format }` with points in Selig order: trailing edge, upper surface,
 *   leading edge, lower surface.
 */
export function parseAirfoilText(text) {
  const rows = String(text).split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) throw new Error('airfoil file is empty');
  const pair = (row) => {
    const tokens = row.split(/[\s,;]+/);
    return tokens.length === 2 && tokens.every((v) => Number.isFinite(Number(v))) ? tokens.map(Number) : null;
  };
  let name = 'unnamed';
  if (!pair(rows[0])) name = rows.shift();
  let format = name === 'unnamed' ? 'ledger' : 'selig';
  const header = pair(rows[0] ?? '');
  const counts = header && header.every((v) => Number.isInteger(v) && v >= 3) && rows.length - 1 === header[0] + header[1] ? header : null;
  if (counts) { rows.shift(); format = 'lednicer'; }
  let points = rows.map((row, i) => {
    const p = pair(row);
    if (!p) throw new Error('invalid coordinate row ' + (i + 1));
    return p;
  });
  if (counts) {
    const first = points.slice(0, counts[0]);
    const second = points.slice(counts[0]);
    if (first[0][0] > first.at(-1)[0][0] || second[0][0] > second.at(-1)[0][0]) throw new Error('Lednicer surfaces must run leading edge to trailing edge');
    const mean = (surface) => surface.reduce((sum, p) => sum + p[1], 0) / surface.length;
    const upper = mean(first) >= mean(second) ? first : second;
    const lower = upper === first ? second : first;
    if (Math.hypot(upper[0][0] - lower[0][0], upper[0][1] - lower[0][1]) > 1e-6) throw new Error('Lednicer leading edges do not coincide');
    points = [...upper.slice().reverse(), ...lower.slice(1)];
  }
  if (points.length < 6) throw new Error('airfoil file needs at least six coordinate pairs');
  let leadingIndex = points.reduce((best, p, i) => p[0] < points[best][0] ? i : best, 0);
  if (leadingIndex === 0 || leadingIndex === points.length - 1) throw new Error('airfoil file must run trailing edge to leading edge and back');
  const first = points.slice(0, leadingIndex + 1);
  const second = points.slice(leadingIndex);
  const mean = (half) => half.reduce((sum, p) => sum + p[1], 0) / half.length;
  if (mean(first) < mean(second)) points.reverse();
  return { name, points, format };
}

/**
 * Scale coordinates to a unit chord, so callers may supply millimetre coordinate files.
 * @param points - raw coordinates.
 * @returns unit-chord coordinates.
 */
export function normalizeChord(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('airfoil coordinates need at least two points');
  }
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) throw new Error('each airfoil coordinate must be an [x, y] pair');
    const x = finiteNumber(point[0], 'profile x');
    const y = finiteNumber(point[1], 'profile y');
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('airfoil coordinates must be finite numbers');
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  const chord = max - min;
  if (!(chord > 0)) throw new Error('airfoil coordinates have zero chord');
  return points.map(([x, y]) => [(Number(x) - min) / chord, Number(y) / chord]);
}

/**
 * Resample a closed profile loop onto a cosine distribution with a fixed point count.
 * @param loop - a closed loop in Selig order (trailing edge, upper, leading edge, lower).
 * @param count - points per surface.
 * @returns the resampled loop.
 */
export function resampleLoop(loop, count = 40) {
  count = boundedInteger(count, 40, 2, 200, 'count');
  loop = loop.map((p, i) => vector(p, 2, 'profile[' + i + ']'));
  if (loop.length < 4) throw new Error('profile needs at least four points');
  let leadingIndex = 0;
  for (let i = 1; i < loop.length; i += 1) {
    if (loop[i][0] < loop[leadingIndex][0]) leadingIndex = i;
  }
  if (leadingIndex === 0 || leadingIndex === loop.length - 1) throw new Error('profile must run trailing edge to leading edge and back');
  const upper = loop.slice(0, leadingIndex + 1).slice().reverse(); // leading edge -> trailing edge
  const lower = loop.slice(leadingIndex); // leading edge -> trailing edge
  for (const surface of [upper, lower]) {
    if (surface.some((p, i) => i > 0 && p[0] < surface[i - 1][0] - 0.002)) throw new Error('profile surface reverses chord direction');
    surface.sort((a, b) => a[0] - b[0]);
  }
  if ([upper, lower].some((surface) => surface.at(-1)[0] < 0.99)) throw new Error('both profile surfaces must reach the trailing edge');
  const interpolate = (surface, x) => {
    if (x <= surface[0][0]) return surface[0][1];
    const last = surface[surface.length - 1];
    if (x >= last[0]) return last[1];
    for (let i = 1; i < surface.length; i += 1) {
      const [x1, y1] = surface[i];
      if (x1 >= x) {
        const [x0, y0] = surface[i - 1];
        const span = x1 - x0;
        const t = span === 0 ? 0 : (x - x0) / span;
        return y0 + t * (y1 - y0);
      }
    }
    return last[1];
  };
  const xs = [];
  for (let i = 0; i < count; i += 1) {
    xs.push(0.5 * (1 - Math.cos((Math.PI * i) / (count - 1))));
  }
  const out = [];
  for (let i = xs.length - 1; i >= 0; i -= 1) out.push([xs[i], interpolate(upper, xs[i])]);
  for (let i = 1; i < xs.length; i += 1) out.push([xs[i], interpolate(lower, xs[i])]);
  if (Math.hypot(...out[0].map((v, i) => v - out.at(-1)[i])) < 1e-10) out.pop();
  return out;
}

/**
 * Place a normalized profile loop as a 3D section.
 * @param loop - unit-chord loop in Selig order.
 * @param params - `chord`, `aoaDeg`, `twistDeg`, `origin` `[x,y,z]`, `pivot` (`le` or `quarterChord`),
 *   `thicknessScale`.
 * @returns 3D points, ready to be written into a CATIA sketch-free spline.
 */
export function section3d(loop, params) {
  const chord = finiteNumber(params.chord, 'chord', 0.1, 100000);
  if (!Number.isFinite(chord) || chord <= 0) throw new Error(`chord must be a positive length, got ${params.chord}`);
  const aoa = optionalNumber(params.aoaDeg, 'aoaDeg', 0, -180, 180);
  const twist = optionalNumber(params.twistDeg, 'twistDeg', 0, -180, 180);
  const thicknessScale = optionalNumber(params.thicknessScale, 'thicknessScale', 1, 0.02, 5);
  const pivot = params.pivot === 'quarterChord' ? 0.25 : 0;
  if (params.pivot !== undefined && !['le', 'quarterChord'].includes(params.pivot)) throw new Error('pivot must be le or quarterChord');
  const origin = vector(params.origin === undefined ? [0, 0, 0] : params.origin, 3, 'origin');
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every((v) => Number.isFinite(Number(v)))) {
    throw new Error('origin must be three finite numbers [x, y, z]');
  }
  // A positive angle of attack raises the leading edge relative to the trailing edge; with +X aft
  // that is a clockwise rotation in the XY plane, i.e. a negative rotation about +Z.
  const theta = (-(aoa + twist) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return loop.map((point, i) => {
    const [xn, yn] = vector(point, 2, 'profile[' + i + ']');
    const x = (xn - pivot) * chord;
    const y = yn * chord * thicknessScale;
    return [
      Number(origin[0]) + x * cos - y * sin,
      Number(origin[1]) + x * sin + y * cos,
      Number(origin[2]),
    ];
  });
}

/**
 * Split a wing into spanwise stations using a linear chord/angle/twist law.
 * @param params - wing parameters: `span`, `chordRoot`, `chordTip`, `aoaRoot`, `twist`,
 *   `sweepDeg`, `dihedralDeg`, `zStart`, `stations`, `thicknessScale`.
 * @returns one entry per station with its resolved placement.
 */
export function wingStations(params) {
  const span = finiteNumber(params.span, 'span', 0.1, 100000);
  if (!Number.isFinite(span) || span <= 0) throw new Error(`span must be a positive length, got ${params.span}`);
  const stations = integerOption(params.stations, 5, 2, 24, 'stations');
  const chordRoot = finiteNumber(params.chordRoot ?? params.chord, 'chordRoot', 0.1, 100000);
  const chordTip = optionalNumber(params.chordTip, 'chordTip', chordRoot, 0.1, 100000);
  if (!(chordRoot > 0) || !(chordTip > 0)) throw new Error('chordRoot and chordTip must be positive lengths');
  const aoaRoot = optionalNumber(params.aoaRoot, 'aoaRoot', 0, -180, 180);
  const twist = optionalNumber(params.twist, 'twist', 0, -180, 180);
  const sweep = (optionalNumber(params.sweepDeg, 'sweepDeg', 0, -80, 80) * Math.PI) / 180;
  const dihedral = (optionalNumber(params.dihedralDeg, 'dihedralDeg', 0, -80, 80) * Math.PI) / 180;
  const zStart = optionalNumber(params.zStart, 'zStart', 0, -100000, 100000);
  const thicknessScale = optionalNumber(params.thicknessScale, 'thicknessScale', 1, 0.02, 5);
  const out = [];
  for (let i = 0; i < stations; i += 1) {
    const t = i / (stations - 1);
    const z = zStart + span * t;
    const local = z - zStart;
    out.push({
      pivot: params.pivot,
      index: i + 1,
      t,
      z,
      chord: chordRoot + (chordTip - chordRoot) * t,
      aoaDeg: aoaRoot + twist * t,
      origin: [
        optionalNumber(params.xOffset, 'xOffset', 0, -100000, 100000) + local * Math.tan(sweep),
        optionalNumber(params.yOffset, 'yOffset', 0, -100000, 100000) + local * Math.tan(dihedral),
        z,
      ],
      thicknessScale,
    });
  }
  return out;
}

/**
 * Build a wing section loop for one station.
 * @param loop - the normalized profile loop.
 * @param station - one entry from {@link wingStations}.
 * @returns 3D points.
 */
export function stationPoints(loop, station) {
  return section3d(loop, {
    chord: station.chord,
    aoaDeg: station.aoaDeg,
    origin: station.origin,
    thicknessScale: station.thicknessScale,
    pivot: station.pivot,
  });
}

/**
 * Resolve a profile request into a normalized loop.
 * @param request - `naca`, `coordinates`, or `points` (already parsed pairs); plus `count`.
 * @returns `{ loop, source, name }`.
 */
export function resolveProfile(request) {
  if (request?.invertProfile !== undefined && typeof request.invertProfile !== 'boolean') throw new Error('invertProfile must be boolean');
  const oriented = loop => request.invertProfile === true ? loop.map(([x,y]) => [x,-y]) : loop;
  if (request?.naca !== undefined && request?.coordinates !== undefined) throw new Error('provide naca or coordinates, not both');
  if (typeof request?.naca === 'string' && request.naca.trim() !== '') {
    const loop = naca4Loop(request.naca, { count: request.count ?? 40 });
    return { loop: oriented(loop), source: 'naca-generator', name: `NACA${request.naca}` };
  }
  const raw = request?.coordinates;
  if (Array.isArray(raw) && raw.length >= 6) {
    const pairs = raw.map((entry, index) => {
      if (Array.isArray(entry) && entry.length === 2) return vector(entry, 2, 'coordinates[' + index + ']');
      throw new Error(`coordinates[${index}] must be a pair [x, y]`);
    });
    if (!pairs.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      throw new Error('coordinates must contain finite numbers');
    }
    const unit = normalizeChord(pairs);
    const loop = resampleLoop(unit, request.count ?? 40);
    return { loop: oriented(loop), source: 'supplied-coordinates', name: request.name ?? 'supplied profile' };
  }
  throw new Error('provide either `naca` (4-digit code) or `coordinates` (x/y pairs) for the profile');
}
