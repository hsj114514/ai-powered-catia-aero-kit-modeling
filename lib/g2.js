// SPDX-License-Identifier: GPL-3.0-only
/** Quintic Bezier endpoint solver. No COM, no numerical optimisation dependency. */
import { vector, optionalNumber, integerOption } from './validation.js';
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const mul = (v, s) => v.map(x => x * s);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = v => Math.hypot(...v);
function unit(value, label) {
  const v = vector(value, 3, label), n = norm(v);
  if (n < 1e-9) throw new Error(label + ' must not be zero');
  return mul(v, 1 / n);
}
export function evaluateBezier(control, t, order = 0) {
  if (!Array.isArray(control) || control.length < 3 || control.length > 16) throw new Error('Bezier requires 3..16 control points');
  control = control.map(p => vector(p, 3, 'Bezier control'));
  if (!Number.isFinite(t) || t < 0 || t > 1 || !Number.isInteger(order) || order < 0 || order > 2) throw new Error('invalid Bezier evaluation');
  let p = control.map(v => v.slice());
  for (let k = 0; k < order; k++) {
    const degree = p.length - 1;
    p = p.slice(1).map((v, i) => mul(sub(v, p[i]), degree));
  }
  while (p.length > 1) p = p.slice(1).map((v, i) => add(mul(p[i], 1 - t), mul(v, t)));
  return p[0];
}
export function endpointJet(control, t) {
  const first = evaluateBezier(control, t, 1), second = evaluateBezier(control, t, 2), speed = norm(first);
  if (speed < 1e-9) throw new Error('zero-speed endpoint');
  const tangent = mul(first, 1 / speed);
  const curvature = mul(sub(second, mul(tangent, dot(second, tangent))), 1 / (speed * speed));
  return { point: evaluateBezier(control, t), tangent, curvature, speed };
}
export function solveG2(args) {
  const start = vector(args.start, 3, 'start'), end = vector(args.end, 3, 'end');
  const chord = norm(sub(end, start));
  if (chord < 1e-6) throw new Error('G2 endpoints must differ');
  const t0 = unit(args.tangentStart, 'tangentStart'), t1 = unit(args.tangentEnd, 'tangentEnd');
  const k0 = vector(args.curvatureStart ?? [0, 0, 0], 3, 'curvatureStart');
  const k1 = vector(args.curvatureEnd ?? [0, 0, 0], 3, 'curvatureEnd');
  if (Math.abs(dot(t0, k0)) > 1e-8 * Math.max(1, norm(k0)) || Math.abs(dot(t1, k1)) > 1e-8 * Math.max(1, norm(k1))) throw new Error('curvature vector must be perpendicular to its tangent');
  const s0 = optionalNumber(args.speedStart, 'speedStart', chord, 1e-6, 1e6);
  const s1 = optionalNumber(args.speedEnd, 'speedEnd', chord, 1e-6, 1e6);
  const count = integerOption(args.count, 65, 8, 256, 'count');
  const p1 = add(start, mul(t0, s0 / 5)), p4 = sub(end, mul(t1, s1 / 5));
  const p2 = add(sub(mul(p1, 2), start), mul(k0, s0 * s0 / 20));
  const p3 = add(sub(mul(p4, 2), end), mul(k1, s1 * s1 / 20));
  const control = [start, p1, p2, p3, p4, end];
  if (control.flat().some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error('G2 control polygon exceeds numeric range');
  const points = Array.from({ length: count }, (_, i) => evaluateBezier(control, i / (count - 1)));
  const jets = [endpointJet(control, 0), endpointJet(control, 1)];
  const residual = Math.max(norm(sub(jets[0].point, start)), norm(sub(jets[1].point, end)), norm(sub(jets[0].tangent, t0)), norm(sub(jets[1].tangent, t1)), norm(sub(jets[0].curvature, k0)), norm(sub(jets[1].curvature, k1)));
  if (residual > 1e-7) throw new Error('G2 endpoint residual exceeds tolerance');
  let minSampledSpeed = Infinity;
  for (let i = 0; i <= 512; i++) minSampledSpeed = Math.min(minSampledSpeed, norm(evaluateBezier(control, i / 512, 1)));
  if (minSampledSpeed < 1e-6) throw new Error('sampled G2 curve has a cusp or stationary point; change tangent or speed');
  return { degree: 5, controlPoints: control, points, endpointJets: jets, endpointResidual: residual, minSampledSpeed,
    status: 'SUCCESS', level: 0, nativeGeometryVerified: false,
    detail: 'Analytic quintic has the specified G2 endpoint jets. Sampling/interpolating these points does not certify CATIA G2. Sampled speed is not a proof of global regularity or absence of self-intersection.' };
}
