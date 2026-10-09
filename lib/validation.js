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


/**
 * Make a tool result lossless JSON. The harness rejects `undefined` properties, non-finite
 * numbers, negative zero and class instances, so a handler that builds an optional field as
 * `undefined` makes a *successful* build report "value is not lossless JSON". Applied once, at
 * the `tool()` boundary in tools.js.
 *
 * @param value - any handler result.
 * @returns a plain-object/array tree of strings, booleans, finite numbers and null.
 */
export function toLossless(value, seen = new Set()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) return null;              // NaN, +-Infinity
    return Object.is(value, -0) ? 0 : value;               // negative zero is rejected by the harness
  }
  if (type === 'undefined' || type === 'function' || type === 'symbol') return undefined; // dropped
  if (type === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    if (seen.has(value)) return null;                      // cycle
    seen.add(value);
    const out = value.map((entry) => {
      const converted = toLossless(entry, seen);
      return converted === undefined ? null : converted;   // arrays must stay dense
    });
    seen.delete(value);
    return out;
  }
  if (type === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) return Object.prototype.toString.call(value);
    if (seen.has(value)) return null;
    seen.add(value);
    const out = {};
    for (const key of Object.keys(value)) {
      const converted = toLossless(value[key], seen);
      if (converted !== undefined) out[key] = converted;    // drop undefined properties
    }
    seen.delete(value);
    return out;
  }
  return undefined;
}