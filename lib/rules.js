// SPDX-License-Identifier: GPL-3.0-only
/** Read-only rule screening, independent of the tool transport and CATIA session. */
import { elementGeometry } from './ops.js';

/** Clip exact points/segments to an axis-aligned region. Sampled splines retain conservative boxes. */
function regionBox(geometry, min = [-Infinity, -Infinity, -Infinity], max = [Infinity, Infinity, Infinity]) {
  const box = geometry.bounds;
  if (!geometry.boundsCertified) return [0, 1, 2].every((axis) => box.max[axis] >= min[axis] && box.min[axis] <= max[axis]) ? box : null;
  const clipped = [];
  for (const contour of geometry.contours) {
    for (let i = 0; i < Math.max(1, contour.length - 1); i += 1) {
      const a = contour[i];
      const b = contour[i + 1] ?? a;
      let lo = 0;
      let hi = 1;
      for (let axis = 0; axis < 3; axis += 1) {
        const d = b[axis] - a[axis];
        if (d === 0) { if (a[axis] < min[axis] || a[axis] > max[axis]) { lo = 1; hi = 0; break; } }
        else {
          const p = (min[axis] - a[axis]) / d;
          const q = (max[axis] - a[axis]) / d;
          lo = Math.max(lo, Math.min(p, q));
          hi = Math.min(hi, Math.max(p, q));
        }
      }
      if (lo <= hi) for (const t of [lo, hi]) clipped.push(a.map((v, axis) => v + (b[axis] - v) * t));
    }
  }
  return clipped.length ? { points: clipped, min: [0, 1, 2].map((axis) => Math.min(...clipped.map((p) => p[axis]))), max: [0, 1, 2].map((axis) => Math.max(...clipped.map((p) => p[axis]))) } : null;
}

export function checkGeometryRules(ledger, args, project) {

  if (!ledger) return { status: 'BLOCKED', level: 0, project, errors: ['no ledger for this project'] };
  const rules = args.rules === undefined ? (ledger.constraints ?? {}) : args.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return { status: 'BLOCKED', level: 0, project, errors: ['rules must be an object'] };
  const numericKeys = ['groundY', 'maxSpan', 'maxWidth', 'maxLength', 'maxHeight', 'minGroundClearance', 'minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ', 'frontTireFrontX', 'maxAheadOfFrontTire', 'rearTireRearX', 'maxBehindRearTire', 'headrestBackX', 'maxHeightAheadOfHeadrest', 'maxHeightBehindHeadrest', 'frontAxleX', 'frontTireInnerZ', 'rearAxleX', 'frontTireOuterZ', 'rearTireOuterZ', 'rearTireInnerZ'];
  const supportedKeys = new Set([...numericKeys, 'exclusionZones', 'heightZones']);
  if (!Object.keys(rules).some((key) => supportedKeys.has(key))) return { status: 'BLOCKED', level: 0, project, errors: ['provide at least one supported geometric rule and the required vehicle datums'] };
  const invalid = Object.keys(rules).filter((key) => !supportedKeys.has(key));
  invalid.push(...numericKeys.filter((key) => rules[key] !== undefined && (typeof rules[key] !== 'number' || !Number.isFinite(rules[key]))));
  const lengths = ['maxSpan', 'maxWidth', 'maxLength', 'maxHeight', 'minGroundClearance', 'maxAheadOfFrontTire', 'maxBehindRearTire', 'maxHeightAheadOfHeadrest', 'maxHeightBehindHeadrest'];
  invalid.push(...lengths.filter((key) => rules[key] !== undefined && rules[key] < 0));
  const validBox = (box) => Array.isArray(box) && box.length === 3 && box.every((n) => typeof n === 'number' && Number.isFinite(n));
  for (const [key, datum] of [['maxAheadOfFrontTire', 'frontTireFrontX'], ['maxBehindRearTire', 'rearTireRearX'], ['maxHeightAheadOfHeadrest', 'headrestBackX'], ['maxHeightBehindHeadrest', 'headrestBackX']]) {
    if (rules[key] !== undefined && rules[datum] === undefined) invalid.push(`${key} requires ${datum}`);
  }
  for (const axis of ['X', 'Y', 'Z']) {
    if (rules[`min${axis}`] > rules[`max${axis}`]) invalid.push(`min${axis} must not exceed max${axis}`);
  }
  if (rules.exclusionZones !== undefined && !Array.isArray(rules.exclusionZones)) invalid.push('exclusionZones');
  if (rules.heightZones !== undefined && !Array.isArray(rules.heightZones)) invalid.push('heightZones');
  for (const zone of (Array.isArray(rules.exclusionZones) ? rules.exclusionZones : [])) {
    if (!validBox(zone?.min) || !validBox(zone?.max) || [0, 1, 2].some((axis) => Number(zone.min[axis]) > Number(zone.max[axis]))) invalid.push(`exclusionZones:${zone?.name ?? 'unnamed'}`);
  }
  for (const zone of (Array.isArray(rules.heightZones) ? rules.heightZones : [])) {
    if (!validBox(zone?.min) || !validBox(zone?.max) || typeof zone?.maxHeight !== 'number' || !Number.isFinite(zone.maxHeight) || zone.maxHeight < 0 || [0, 1, 2].some((axis) => Number(zone.min[axis]) > Number(zone.max[axis]))) invalid.push(`heightZones:${zone?.name ?? 'unnamed'}`);
  }
  const hasLateralEnvelope = ['rearAxleX', 'frontTireOuterZ', 'rearTireOuterZ', 'rearTireInnerZ'].some((key) => rules[key] !== undefined);
  const hasFront250Zone = rules.frontTireInnerZ !== undefined;
  if (hasFront250Zone && rules.frontAxleX === undefined) invalid.push('front250HeightZone requires frontAxleX and frontTireInnerZ');
  if (hasFront250Zone && Number(rules.frontTireInnerZ) <= 0) invalid.push('frontTireInnerZ must be a positive half-width from the centerline');
  if (hasLateralEnvelope && ['frontAxleX', 'rearAxleX', 'frontTireOuterZ', 'rearTireOuterZ', 'rearTireInnerZ'].some((key) => rules[key] === undefined)) invalid.push('lateralEnvelope requires frontAxleX, rearAxleX, frontTireOuterZ, rearTireOuterZ, and rearTireInnerZ');
  if (hasLateralEnvelope && Number(rules.frontAxleX) >= Number(rules.rearAxleX)) invalid.push('frontAxleX must be less than rearAxleX');
  if (hasLateralEnvelope && ['frontTireOuterZ', 'rearTireOuterZ', 'rearTireInnerZ'].some((key) => Number(rules[key]) <= 0)) invalid.push('lateral tire Z limits must be positive half-widths from the centerline');
  if (hasLateralEnvelope && rules.rearTireInnerZ >= rules.rearTireOuterZ) invalid.push('rear tire inner half-width must be less than outer half-width');
  if (hasFront250Zone && rules.frontTireOuterZ !== undefined && rules.frontTireInnerZ >= rules.frontTireOuterZ) invalid.push('front tire inner half-width must be less than outer half-width');
  if (invalid.length > 0) return { status: 'BLOCKED', level: 0, project, errors: [`invalid geometric rule values: ${invalid.join(', ')}`] };
  const checkedRules = [];
  if (rules.maxSpan !== undefined || rules.maxWidth !== undefined) checkedRules.push('lateralExtent');
  for (const key of ['maxLength', 'maxHeight', 'minGroundClearance', 'minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ']) {
    if (rules[key] !== undefined) checkedRules.push(key);
  }
  if (rules.frontTireFrontX !== undefined) checkedRules.push('frontTireExtension');
  if (rules.rearTireRearX !== undefined) checkedRules.push('rearTireExtension');
  if (rules.headrestBackX !== undefined) checkedRules.push('headrestHeightRegions');
  if (hasFront250Zone) checkedRules.push('front250HeightZone');
  if (hasLateralEnvelope) checkedRules.push('lateralTireEnvelope');
  for (const key of ['exclusionZones', 'heightZones']) {
    if (rules[key]?.length > 0) checkedRules.push(key);
  }
  if (checkedRules.length === 0) return { status: 'BLOCKED', level: 0, project, checkedRules, errors: ['No executable geometric checks: supply limits together with their required vehicle datums.'] };
  const groundY = rules.groundY ?? 0;
  if (args.elementIds !== undefined && (!Array.isArray(args.elementIds) || args.elementIds.length === 0 || args.elementIds.some((id) => typeof id !== 'string' || !Object.hasOwn(ledger.elements, id)))) return { status: 'BLOCKED', level: 0, project, errors: ['elementIds must name existing ledger elements'] };
  const selected = args.elementIds ? [...new Set(args.elementIds)].map((id) => ledger.elements[id]) : Object.values(ledger.elements);
  const geometryQuality = {};
  const geometries = {};
  const uncertainElements = [];
  const boxes = Object.create(null);
  const violations = [];
  const uncheckedElements = [];
  for (const element of selected) {
    let geometry;
    try { geometry = elementGeometry(element, ledger.elements); } catch { geometry = null; }
    const box = geometry?.bounds;
    if (!box) { uncheckedElements.push(element.id); continue; }
    boxes[element.id] = box;
    geometries[element.id] = geometry;
    geometryQuality[element.id] = geometry.quality;
    if (!geometry.boundsCertified) uncertainElements.push(element.id);
  }
  const aggregate = Object.keys(boxes).length > 0
    ? {
      min: [0, 1, 2].map((axis) => Math.min(...Object.values(boxes).map((b) => b.min[axis]))),
      max: [0, 1, 2].map((axis) => Math.max(...Object.values(boxes).map((b) => b.max[axis]))),
    }
    : null;
  const metrics = {};
  const usedDefaults = {};
  if (aggregate) {
    const [minX, minY, minZ] = aggregate.min;
    const [maxX, maxY, maxZ] = aggregate.max;
    // "Overall width" is the lateral dimension of the car, which is the same quantity as the
    // span. The two keys are therefore aliases and the check runs once, naming whichever keys
    // the caller supplied, so one geometry is never reported as two violations.
    const span = maxZ - minZ;
    const width = span;
    const height = maxY - minY;
    metrics.span_mm = span.toFixed(1);
    metrics.width_mm = width.toFixed(1);
    metrics.height_mm = height.toFixed(1);
    metrics.topY_mm = maxY.toFixed(1);
    metrics.length_mm = (maxX - minX).toFixed(1);
    metrics.lowestPoint_mm = minY.toFixed(1);
    metrics.heightDatum = `Y = ${groundY} mm is the ground plane`;
    metrics.groundClearance_mm = (minY - groundY).toFixed(1);
    const spanLimits = [rules.maxSpan, rules.maxWidth].filter((value) => value !== undefined).map(Number);
    if (spanLimits.length > 0) {
      const limit = Math.min(...spanLimits);
      const named = [
        rules.maxSpan !== undefined ? `maxSpan ${rules.maxSpan} mm` : null,
        rules.maxWidth !== undefined ? `maxWidth ${rules.maxWidth} mm` : null,
      ].filter(Boolean).join(' and ');
      if (span > limit) violations.push(`lateral extent ${span.toFixed(1)} mm exceeds ${named} (maxSpan and maxWidth are the same lateral dimension, so this is one violation)`);
    }
    if (rules.maxHeight !== undefined && maxY - groundY > Number(rules.maxHeight)) violations.push(`top Y ${maxY.toFixed(1)} mm exceeds maxHeight ${rules.maxHeight} mm`);
    if (rules.maxLength !== undefined && maxX - minX > Number(rules.maxLength)) violations.push(`length ${(maxX - minX).toFixed(1)} mm exceeds maxLength ${rules.maxLength} mm`);
    for (const axis of ['X', 'Y', 'Z']) {
      const low = { X: minX, Y: minY, Z: minZ }[axis];
      const high = { X: maxX, Y: maxY, Z: maxZ }[axis];
      if (rules[`min${axis}`] !== undefined && low < Number(rules[`min${axis}`])) violations.push(`min${axis} ${low.toFixed(1)} mm is below ${rules[`min${axis}`]} mm`);
      if (rules[`max${axis}`] !== undefined && high > Number(rules[`max${axis}`])) violations.push(`max${axis} ${high.toFixed(1)} mm exceeds ${rules[`max${axis}`]} mm`);
    }
    if (rules.minGroundClearance !== undefined && minY - groundY < Number(rules.minGroundClearance)) {
      violations.push(`lowest point ${minY.toFixed(1)} mm is below the required ground clearance ${rules.minGroundClearance} mm`);
    }
    // Regional limits are evaluated per design element rather than against the whole-model
    // aggregate: mixing a global height with a regional X test flags a tall element that sits
    // behind the headrest plane as though it were ahead of it, and it cannot name the element.
    const perElement = (predicate, describe) => {
      for (const [id, box] of Object.entries(boxes)) {
        if (predicate(box)) violations.push(`${id} ${describe(box)}`);
      }
    };
    if (rules.frontTireFrontX !== undefined) {
      const ahead = Number(rules.maxAheadOfFrontTire ?? 700);
      const limit = Number(rules.frontTireFrontX) - ahead;
      usedDefaults.maxAheadOfFrontTire = ahead;
      perElement(
        (box) => box.min[0] < limit,
        (box) => `front extent ${box.min[0].toFixed(1)} mm is more than ${ahead} mm ahead of the front tire (limit X=${limit.toFixed(1)} mm)`,
      );
    }
    if (rules.rearTireRearX !== undefined) {
      const behind = Number(rules.maxBehindRearTire ?? 250);
      const limit = Number(rules.rearTireRearX) + behind;
      usedDefaults.maxBehindRearTire = behind;
      perElement(
        (box) => box.max[0] > limit,
        (box) => `rear extent ${box.max[0].toFixed(1)} mm is more than ${behind} mm behind the rear tire (limit X=${limit.toFixed(1)} mm)`,
      );
    }
    // The supplied diagram uses this plane to split the 500/1200 mm height regions.
    // A separate longitudinal stop must be stated explicitly with maxX.
    if (rules.headrestBackX !== undefined) {
      const plane = Number(rules.headrestBackX);
      const aheadLimit = Number(rules.maxHeightAheadOfHeadrest ?? 500);
      const behindLimit = Number(rules.maxHeightBehindHeadrest ?? 1200);
      usedDefaults.maxHeightAheadOfHeadrest = aheadLimit;
      usedDefaults.maxHeightBehindHeadrest = behindLimit;
      for (const [id, geometry] of Object.entries(geometries)) {
        const box = geometry.bounds;
        const aheadBox = box.min[0] < plane ? regionBox(geometry, undefined, [plane, Infinity, Infinity]) : null;
        const behindBox = box.max[0] >= plane ? regionBox(geometry, [plane, -Infinity, -Infinity]) : null;
        if (aheadBox && aheadBox.max[1] - groundY > aheadLimit) violations.push(id + ' above the ' + aheadLimit + ' mm limit ahead of the headrest plane');
        if (behindBox && behindBox.max[1] - groundY > behindLimit) violations.push(id + ' above the ' + behindLimit + ' mm limit behind the headrest plane');
      }
    }
    if (hasFront250Zone) {
      const frontAxle = rules.frontAxleX;
      const innerTire = rules.frontTireInnerZ;
      for (const [id, geometry] of Object.entries(geometries)) {
        if (geometry.bounds.min[0] >= frontAxle) continue;
        const left = geometry.bounds.min[2] < -innerTire ? regionBox(geometry, undefined, [frontAxle, Infinity, -innerTire]) : null;
        const right = geometry.bounds.max[2] > innerTire ? regionBox(geometry, [-Infinity,-Infinity,innerTire], [frontAxle,Infinity,Infinity]) : null;
        if ([left,right].some((box) => box && box.max[1] - groundY > 250)) violations.push(id + ' exceeds the T9.6 250 mm height limit in the region ahead of the front axle and outside the inner-front-tire planes');
      }
    }
    if (hasLateralEnvelope && aggregate) {
      const frontAxle = Number(rules.frontAxleX);
      const rearAxle = Number(rules.rearAxleX);
      const frontOuter = Number(rules.frontTireOuterZ);
      const rearOuter = Number(rules.rearTireOuterZ);
      const rearInner = Number(rules.rearTireInnerZ);
      for (const [id, box] of Object.entries(boxes)) {
        const checkZone = (zone, limitAt) => {
          const lo = Math.max(box.min[0], zone[0]);
          const hi = Math.min(box.max[0], zone[1]);
          if (lo > hi) return;
          const limit = Math.min(limitAt(lo), limitAt(hi));
          const clipped = regionBox(geometries[id], [zone[0],-Infinity,-Infinity], [zone[1],Infinity,Infinity]);
    if (!clipped) return;
    const extent = Math.max(Math.abs(clipped.min[2]), Math.abs(clipped.max[2]));
          if (geometries[id].boundsCertified ? clipped.points.some((p) => Math.abs(p[2]) > limitAt(p[0])) : extent > limit) violations.push(`${id} lateral envelope ${extent.toFixed(1)} mm exceeds T9.5 limit ${limit.toFixed(1)} mm in X=${lo.toFixed(1)}..${hi.toFixed(1)} mm`);
        };
        checkZone([-Infinity, frontAxle], () => frontOuter);
        checkZone([frontAxle, rearAxle], (x) => frontOuter + (rearOuter - frontOuter) * ((x - frontAxle) / (rearAxle - frontAxle)));
        if (box.max[0] > rearAxle) checkZone([rearAxle, Infinity], () => rearInner);
      }
    }
    for (const zone of Array.isArray(rules.exclusionZones) ? rules.exclusionZones : []) {
      for (const [id, box] of Object.entries(boxes)) {
        const clipped = regionBox(geometries[id], zone.min, zone.max);
        if (clipped) violations.push(`${id} ${geometries[id].boundsCertified ? 'intersects' : 'possibly intersects'} exclusion zone ${zone.name ?? 'unnamed'}`);
      }
    }
    for (const zone of Array.isArray(rules.heightZones) ? rules.heightZones : []) {
      for (const [id, box] of Object.entries(boxes)) {
        const clipped = regionBox(geometries[id], zone.min, zone.max);
        if (clipped && clipped.max[1] - groundY > Number(zone.maxHeight)) violations.push(`${id} reaches Y=${box.max[1].toFixed(1)} mm inside height zone ${zone.name ?? 'unnamed'} (limit ${zone.maxHeight} mm)`);
      }
    }
  }
  return {
    status: Object.keys(boxes).length === 0 ? 'BLOCKED' : violations.length === 0 && uncheckedElements.length === 0 && uncertainElements.length === 0 ? 'SUCCESS' : 'PARTIAL_SUCCESS',
    level: 0,
    project,
    version: ledger.version,
    checkedRules,
    uncheckedElements,
    uncertainElements,
    geometryQuality,
    screeningOnly: uncertainElements.length > 0,
    checkedElements: Object.keys(boxes),
    skippedElements: Object.keys(ledger.elements).filter((id) => !selected.some((e) => e.id === id)),
    fullCompetitionCompliance: false,
    metrics,
    items: Object.entries(boxes).map(([id, box]) => `${id}: ${box.min.map((v) => v.toFixed(1)).join(',')} .. ${box.max.map((v) => v.toFixed(1)).join(',')}`),
    errors: violations,
    detail: uncertainElements.length > 0 ? 'Sampled design inputs were screened; final CATIA splines and lofts need measured bounds. Box conflicts are potential conflicts, not certified intersections.' : violations.length === 0
      ? (Object.keys(boxes).length === 0 ? 'No parameter-derived geometry is available to check.' : uncheckedElements.length > 0 ? 'Available geometry passes the supplied checks, but some elements could not be checked.' : 'The parameter-derived aero geometry satisfies the geometric limits supplied for this check; this is not complete competition compliance.')
      : 'Geometric constraint conflicts found; review the supplied datums and limits before modelling further.',
    notes: [
      ...(Object.keys(boxes).length === 0 ? ['No element geometry could be derived from the ledger.'] : []),
      'The check uses parameter-derived bounding boxes, not a measurement of the final CATIA surfaces.',
      ...(uncertainElements.length ? [`Uncertified spline/loft input bounds: ${uncertainElements.join(', ')}. A passing sample does not prove a passing surface.`] : []),
      `Executed checks: ${checkedRules.join(', ')}.`,
      ...(uncheckedElements.length ? [`Elements without derivable bounds: ${uncheckedElements.join(', ')}.`] : []),
      ...(rules.headrestBackX !== undefined ? ['headrestBackX is a height-region datum following the supplied diagram, not an automatic rear stop. Use maxX for an explicitly confirmed longitudinal stop; the wording of T9.3.2 needs separate rule review.'] : []),
      ...(Object.keys(usedDefaults).length > 0
        ? [`Applied rule defaults (mm): ${Object.entries(usedDefaults).map(([key, value]) => `${key}=${value}`).join(', ')}. Supply the limit explicitly to override.`]
        : []),
      `Height limits are measured from Y = ${groundY}; groundY defaults to Y = 0.`,
      ...(rules.frontTireFrontX === undefined ? ['Front-tire longitudinal datum was not supplied; the 700 mm front limit was not checked.'] : []),
      ...(rules.rearTireRearX === undefined ? ['Rear-tire longitudinal datum was not supplied; the 250 mm rear limit was not checked.'] : []),
      ...(rules.headrestBackX === undefined ? ['Headrest plane was not supplied; the headrest-related geometry limits were not checked.'] : []),
      ...(hasFront250Zone ? ['T9.6 250 mm front region uses a conservative element bounding box.'] : ['Front axle and inner-front-tire datums were not supplied; the T9.6 250 mm region was not checked.']),
      ...(!hasLateralEnvelope ? ['T9.5 lateral tire datums were not supplied; lateral width envelopes were not checked.'] : ['T9.5 lateral screening uses element bounding boxes and may flag conservative conflicts for swept geometry.']),
      'Leading-edge radii and complete vehicle geometry still require separate review.',
    ],
  };
}
