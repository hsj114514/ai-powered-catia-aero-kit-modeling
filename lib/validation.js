// SPDX-License-Identifier: GPL-3.0-only
/** Shared validation: never turn null, booleans or strings into design dimensions. */
export function finiteNumber(value, label, min = -1e6, max = 1e6) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}`);
  }
  return value;
}

export function optionalNumber(value, label, fallback, min = -1e6, max = 1e6) {
  return finiteNumber(value === undefined ? fallback : value, label, min, max);
}

export function integerOption(value, fallback, min, max, label) {
  const number = optionalNumber(value, label, fallback, min, max);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} must be an integer`);
  return number;
}

export function vector(value, size, label) {
  if (!Array.isArray(value) || value.length !== size) throw new Error(`${label} must have ${size} coordinates`);
  return value.map((entry, i) => finiteNumber(entry, `${label}[${i}]`));
}
