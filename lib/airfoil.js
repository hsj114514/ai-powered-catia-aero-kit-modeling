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
  if (m > 0 && p === 0) throw new Error(`NACA ${text}: a cambered profile needs a non-zero camber position`);
  return { m, p, t };
}

/** Normalize a bounded integer option and reject malformed values explicitly. */
function boundedInteger(value, fallback, min, max, label) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) throw new Error(`${label} must be a finite number`);
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

/**
 * Generate a NACA 4-digit profile as a closed loop of normalized coordinates.
 *
 * The trailing edge is left slightly blunt by default. A mathematically sharp (zero-thickness)
 * trailing edge makes the upper and lower surfaces coincide exactly, and CATIA's multi-section
 * loft then refuses to update on such a section — measured on a section whose
 * trailing-edge ordinates are both 0.000000 fails its loft update, while one at ±0.00126
 * (0.25 mm on a 300 mm chord) lofts normally. Real coordinate files carry the same small finite
 * thickness, so the default matches how an airfoil is actually defined.
 *
 * @param code - four digits, e.g. "2412".
 * @param options - `count` points per surface (default 40), and `closedTrailingEdge` to force the
 *   sharp trailing edge that this CATIA build cannot loft.
 * @returns loop points in Selig order: trailing edge over the upper surface to the leading edge,
 *   then back along the lower surface.
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
  for (let i = 1; i < count - 1; i += 1) loop.push(lower[i]);
  return loop;
}

/**
 * Parse an airfoil coordinate file in Selig (`.dat`) or Ledger format.
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
  const rows = String(text).split(/\r?\n/);
  if (rows.length === 0) throw new Error('airfoil file is empty');
  let name = rows[0].trim();
  let start = 1;
  let ledger = false;
  const probe = name.split(/\s+/).filter((token) => token !== '');
  if (probe.length === 2 && probe.every((token) => Number.isFinite(Number(token)))) {
    ledger = true;
    name = 'unnamed';
    start = 0;
  }
  const points = [];
  for (let i = start; i < rows.length; i += 1) {
    const line = rows[i].trim();
    if (line === '') continue;
    const tokens = line.split(/[\s,;]+/).filter((token) => token !== '');
    if (tokens.length < 2) continue;
    const x = Number(tokens[0]);
    const y = Number(tokens[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([x, y]);
  }
  if (points.length < 6) throw new Error(`airfoil file has only ${points.length} usable coordinate pairs`);

  let leadingIndex = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i][0] < points[leadingIndex][0]) leadingIndex = i;
  }
  if (leadingIndex === 0 || leadingIndex === points.length - 1) {
    throw new Error('airfoil file does not run out to a leading edge and back');
  }
  const firstHalf = points.slice(0, leadingIndex + 1);
  const secondHalf = points.slice(leadingIndex);
  const meanOrdinate = (half) => {
    const inner = half.slice(1, -1);
    const usable = inner.length > 0 ? inner : half;
    return usable.reduce((sum, [, y]) => sum + y, 0) / usable.length;
  };
  const firstIsUpper = meanOrdinate(firstHalf) >= meanOrdinate(secondHalf);
  const ordered = firstIsUpper
    ? [...firstHalf, ...secondHalf.slice(1)]
    : [...secondHalf.slice().reverse(), ...firstHalf.slice().reverse().slice(1)];
  return { name, points: ordered, format: ledger ? 'ledger' : 'selig' };
}

/**
 * Scale coordinates to a unit chord, so callers may supply millimetre coordinate files.
 * @param points - raw coordinates.
 * @returns unit-chord coordinates.
 */
export function normalizeChord(points) {
  if (Array.isArray(points) && points.length > 5000) {
    throw new Error('coordinates must contain at most 5000 points');
  }
  if (!Array.isArray(points) || points.length < 2) {
    throw new Error('airfoil coordinates need at least two points');
  }
  let min = Infinity;
  let max = -Infinity;
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 2) throw new Error('each airfoil coordinate must be an [x, y] pair');
    const x = Number(point[0]);
    const y = Number(point[1]);
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
  let leadingIndex = 0;
  for (let i = 1; i < loop.length; i += 1) {
    if (loop[i][0] < loop[leadingIndex][0]) leadingIndex = i;
  }
  const upper = loop.slice(0, leadingIndex + 1).slice().reverse(); // leading edge -> trailing edge
  const lower = loop.slice(leadingIndex); // leading edge -> trailing edge
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
  for (let i = 1; i < xs.length - 1; i += 1) out.push([xs[i], interpolate(lower, xs[i])]);
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
  const chord = Number(params.chord);
  if (!Number.isFinite(chord) || chord <= 0) throw new Error(`chord must be a positive length, got ${params.chord}`);
  const aoa = Number(params.aoaDeg ?? 0);
  const twist = Number(params.twistDeg ?? 0);
  const thicknessScale = Number(params.thicknessScale ?? 1);
  const pivot = params.pivot === 'quarterChord' ? 0.25 : 0;
  const origin = params.origin ?? [0, 0, 0];
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every((v) => Number.isFinite(Number(v)))) {
    throw new Error('origin must be three finite numbers [x, y, z]');
  }
  // A positive angle of attack raises the leading edge relative to the trailing edge; with +X aft
  // that is a clockwise rotation in the XY plane, i.e. a negative rotation about +Z.
  const theta = (-(aoa + twist) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return loop.map(([xn, yn]) => {
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
  const span = Number(params.span);
  if (!Number.isFinite(span) || span <= 0) throw new Error(`span must be a positive length, got ${params.span}`);
  const stations = Math.max(2, Math.min(24, Math.trunc(params.stations ?? 5)));
  const chordRoot = Number(params.chordRoot ?? params.chord ?? 0);
  const chordTip = Number(params.chordTip ?? params.chord ?? 0);
  if (!(chordRoot > 0) || !(chordTip > 0)) throw new Error('chordRoot and chordTip must be positive lengths');
  const aoaRoot = Number(params.aoaRoot ?? 0);
  const twist = Number(params.twist ?? 0);
  const sweep = (Number(params.sweepDeg ?? 0) * Math.PI) / 180;
  const dihedral = (Number(params.dihedralDeg ?? 0) * Math.PI) / 180;
  const zStart = Number(params.zStart ?? 0);
  const thicknessScale = Number(params.thicknessScale ?? 1);
  const out = [];
  for (let i = 0; i < stations; i += 1) {
    const t = i / (stations - 1);
    const z = zStart + span * t;
    const local = z - zStart;
    out.push({
      index: i + 1,
      t,
      z,
      chord: chordRoot + (chordTip - chordRoot) * t,
      aoaDeg: aoaRoot + twist * t,
      origin: [
        Number(params.xOffset ?? 0) + local * Math.tan(sweep),
        Number(params.yOffset ?? 0) + local * Math.tan(dihedral),
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
  });
}

/**
 * Resolve a profile request into a normalized loop.
 * @param request - `naca`, `coordinates`, or `points` (already parsed pairs); plus `count`.
 * @returns `{ loop, source, name }`.
 */
export function resolveProfile(request) {
  const raw = request?.coordinates;
  if (Array.isArray(raw) && raw.length > 5000) {
    throw new Error('coordinates must contain at most 5000 points');
  }
  if (typeof request?.naca === 'string' && request.naca.trim() !== '') {
    const loop = naca4Loop(request.naca, { count: request.count ?? 40 });
    return { loop, source: 'naca-generator', name: `NACA${request.naca}` };
  }
  if (Array.isArray(raw) && raw.length >= 6) {
    const pairs = raw.map((entry, index) => {
      if (Array.isArray(entry) && entry.length >= 2) return [Number(entry[0]), Number(entry[1])];
      throw new Error(`coordinates[${index}] must be a pair [x, y]`);
    });
    if (!pairs.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) {
      throw new Error('coordinates must contain finite numbers');
    }
    const unit = normalizeChord(pairs);
    const loop = resampleLoop(unit, request.count ?? 40);
    return { loop, source: 'supplied-coordinates', name: request.name ?? 'supplied profile' };
  }
  throw new Error('provide either `naca` (4-digit code) or `coordinates` (x/y pairs) for the profile');
}
