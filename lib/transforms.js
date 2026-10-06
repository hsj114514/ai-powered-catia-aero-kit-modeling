// SPDX-License-Identifier: GPL-3.0-only
/** CATIA Position uses three axis columns followed by the origin; internal matrices use rows. */
import { vector } from './validation.js';

export const CATIA_IDENTITY = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

export function fromCatiaPosition(value) {
  const a = vector(value, 12, 'placement');
  return [a[0], a[3], a[6], a[9], a[1], a[4], a[7], a[10], a[2], a[5], a[8], a[11]];
}

export function rigidPlacement(value) {
  const a = vector(value, 12, 'placement');
  const axes = [a.slice(0, 3), a.slice(3, 6), a.slice(6, 9)];
  const dot = (u, v) => u.reduce((sum, x, i) => sum + x * v[i], 0);
  for (let i = 0; i < 3; i += 1) {
    for (let j = i; j < 3; j += 1) {
      if (Math.abs(dot(axes[i], axes[j]) - (i === j ? 1 : 0)) > 1e-6) throw new Error('placement axes must be orthonormal');
    }
  }
  const [u, v, w] = axes;
  const det = u[0] * (v[1] * w[2] - v[2] * w[1]) - v[0] * (u[1] * w[2] - u[2] * w[1]) + w[0] * (u[1] * v[2] - u[2] * v[1]);
  if (Math.abs(det - 1) > 1e-6) throw new Error('placement must be a proper rotation, without reflection or scale');
  return a;
}

export function composePlacement(parent, local) {
  vector(parent, 12, 'parent matrix');
  vector(local, 12, 'local matrix');
  return Array.from({ length: 12 }, (_, i) => {
    const r = Math.floor(i / 4);
    const c = i % 4;
    let sum = c === 3 ? parent[r * 4 + 3] : 0;
    for (let k = 0; k < 3; k += 1) sum += parent[r * 4 + k] * local[k * 4 + c];
    return sum;
  });
}

export function parseAssemblyRow(line) {
  const parts = String(line).split('|');
  if (parts.length !== 9) throw new Error('assembly row must have nine fields');
  const depth = Number(parts[0]);
  if (!Number.isSafeInteger(depth) || depth < 1) throw new Error('invalid assembly depth');
  const valid = parts[8] === 'resolved';
  if (valid && [...parts.slice(4, 7), ...parts[7].split(',')].some((v) => v.trim() === '' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(v))) throw new Error('invalid numeric assembly field');
  if (!valid && parts[8] !== 'unresolved') throw new Error('invalid placement status');
  const origin = valid ? vector(parts.slice(4, 7).map(Number), 3, 'origin') : null;
  const matrix = valid ? vector(parts[7].split(',').map(Number), 12, 'matrix') : null;
  if (valid && [3, 7, 11].some((i, axis) => Math.abs(matrix[i] - origin[axis]) > 1e-6)) throw new Error('origin and matrix translation disagree');
  return { depth, path: parts[1], name: parts[2], partNumber: parts[3], origin, matrix, placementStatus: parts[8] };
}
