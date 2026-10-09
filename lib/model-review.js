// SPDX-License-Identifier: GPL-3.0-only
/** Parameter/contract advice only: no CAD kernel or claim of watertightness. */
export function reviewModel(elements, errors = []) {
  const list = Array.isArray(elements) ? elements : Object.values(elements);
  const byId = new Map(list.map(e => [e.id, e]));
  const findings = [];
  for (const e of list) {
    if(e.kind==='closed_loft'||e.kind==='capped_extrude')findings.push({id:e.id,code:'matched-caps-volume-required',detail:'End caps and sidewall reuse the same section boundaries and are closed into an independent Body. This is a construction strategy, not offline closure certification; require successful native update and finite positive volume. Multiple Bodies are not a Boolean-unioned endplate.'});
    if(e.kind==='gsd_api'&&e.params.factory==='AddNewAdd') findings.push({id:e.id,code:'boolean-closure-required',detail:'Explicit Body union joins independent solids in dependency order. Native Boolean update and positive volume are mandatory; disconnected/tangent-only/non-manifold contacts may fail and must not trigger gap inflation or hidden geometry replacement.'});
    if (e.kind === 'surface') {
      const sections = e.params.sections ?? [];
      const points = sections.reduce((n, s) => n + s.length, 0);
      if (points > 512) findings.push({ id: e.id, code: 'dense-loft', detail: 'Prefer analytic arcs and explicit sweep/guide curves; dense interpolating lofts increase point count and do not certify exact radius or G2.' });
    }
    if (e.kind === 'gsd' && ['solid_close', 'solid_thick'].includes(e.params.op)) {
      const sourceId = Array.isArray(e.params.from) ? e.params.from[0] : e.params.from;
      const source = byId.get(sourceId);
      if (e.params.op === 'solid_close') findings.push({ id: e.id, code: 'closure-unverified', detail: 'Join tolerance and positive area do not prove a closed oriented manifold. Keep boundary extraction/closure inspection before CloseSurface; report update failure.' });
      if (source?.kind === 'surface' || source?.params?.op === 'join') findings.push({ id: e.id, code: 'offset-risk', detail: 'Thickening a loft/join can fail at seams, self-intersections or tight curvature. Try native fillet/sweep, inspect Trim and Healing, then explicitly construct matched caps if needed. No automatic fallback is certified.' });
    }
    const requestsG2 = e.kind === 'gsd_api' && (
      (e.params.factory === 'AddNewConnect' && [e.params.arguments?.[3],e.params.arguments?.[8]].includes(2)) ||
      (e.params.configure ?? []).some(a =>
        /Continuity/.test(a.property ?? '') && a.value === 2 ||
        a.method === 'SetContinuity' && a.arguments?.[1] === 2 ||
        a.method === 'SetBoundaryContinuity' && a.arguments?.[0] === 2));
    if (requestsG2) findings.push({id:e.id,code:'g2-request-only',detail:'Native G2 parameters are a request to CATIA. Successful update and positive area do not measure G2 boundary residuals.'});
  }
  // Plan-wide policy findings run once, for either an array or an element map.
  const solidBodies = list.filter(e => e.kind === 'closed_loft' || e.kind === 'capped_extrude');
  if (solidBodies.length >= 2 && !list.some(e=>e.kind==='gsd_api'&&e.params.factory==='AddNewAdd')) findings.push({ code: 'separate-bodies-no-boolean', detail: 'This plan closes ' + solidBodies.length + ' solids into independent Bodies and does not Boolean-union them, so the part is a set of closed bodies whose mutual seams are real and must not be presented as one gap-free endplate. Task-matched route: use Sketcher for supported planar polygons; analytic GSD for exact arcs; build the plate as ONE closed solid from a single native closed outline (lines/arcs, shared endpoints), extrude the wall, reuse the same wire for both caps, Join, CloseSurface, and report one finite positive volume.' });
  for (const e of list) {
    const p = e.params ?? {};
    const sampled = p.approximation ?? (typeof p.sampled === 'string' ? { kind: 'sampled', source: p.sampled } : null);
    if (sampled) findings.push({ id: e.id, code: 'sampled-approximation', detail: 'This element declares an approximation (' + (sampled.kind ?? 'unspecified') + (sampled.source ? ' of ' + sampled.source : '') + '). Native GSD first: replace sampled sections with analytic lines/arcs/extrudes or a native sweep where the source permits. A declared approximation must never be reported as an exact rebuild of the source NURBS, and a successful update or a positive area does not certify G2.' });
    const sectionCount = Array.isArray(p.sections) ? p.sections.length : 0;
    if (!sampled && (sectionCount >= 6)) findings.push({ id: e.id, code: 'prefer-native-gsd', detail: 'Task-matched policy: ' + (sectionCount ? sectionCount + ' lofted sections' : 'a contour endplate') + ' approximate geometry that analytic GSD can express exactly. Prefer AddNewLine / AddNewCircle3Points with SetLimitation, AddNewExtrude / Revolve / Sweep, AddNewFill / Join / Trim / Split and the documented fillets; keep sampling only for genuinely free-form sources and declare it via params.approximation.' });
  }
  for (const error of errors) {
    if (/438/.test(error)) findings.push({code:'interface-failure',detail:'438 may indicate unsupported Automation members; separate it from geometry/licence failure. Check documented signatures and CATIA release.'});
    if (/UpdateObject|update failed/i.test(error)) findings.push({code:'geometry-update-failure',detail:'Feature construction succeeded but geometric update failed. Retain the precise feature/stage and do not report the model as generated.'});
  }
  return { status:'SUCCESS',level:0,screeningOnly:true,geometryVerified:false,findings:dedupeFindings(findings),detail:'Offline parameter/contract review only; no CATIA call and no closure, offset or G2 certification.' };
}

/** De-duplicate findings by code+detail: plan-level checks must be reported once, not once per element. */
function dedupeFindings(list) { const seen = new Set(); const out = []; for (const f of list) { const key = (f.id || '') + '|' + (f.code || '') + '|' + (f.detail || ''); if (seen.has(key)) continue; seen.add(key); out.push(f); } return out; }
