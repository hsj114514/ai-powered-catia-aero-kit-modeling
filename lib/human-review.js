// SPDX-License-Identifier: GPL-3.0-only
/** Human-review gate (spec sections 10 and 31). Abnormal topology or unexplained geometry must
 * stop and be handed to a human instead of being silently built. */
export const SAFETY_CRITICAL = ['mount', 'bracket', 'upright', 'tire', 'cockpit', 'harness', 'suspension', 'steering'];
export function requiresHumanReview(plan, options = {}) {
  const reasons = [];
  const steps = plan?.steps ?? [];
  const flapCount = steps.filter((s) => s.kind === 'flap').length;
  if (flapCount > 3) reasons.push('flap count ' + flapCount + ' exceeds the fixed topology limit of 3');
  const kinds = new Set(steps.map((s) => s.kind));
  const allowed = new Set(['point','line','sketch','axis_system','plane','guide_curve','section','wing','flap','endplate','diffuser','gsd','gsd_api','surface','closed_loft','capped_extrude']);
  for (const kind of kinds) if (!allowed.has(kind)) reasons.push('unknown element kind ' + kind + ' (free topology)');
  const unexplained = steps.filter((s) => !s.function && !s.purpose && !s.params?.function && !s.params?.purpose && s.params?.explained !== true).length;
  if (options.requireExplanations && steps.length && unexplained / steps.length > 0.5) reasons.push(unexplained + '/' + steps.length + ' elements carry no declared aero function');
  const name = String(plan?.name ?? '') + ' ' + steps.map((s) => s.id ?? '').join(' ');
  for (const word of SAFETY_CRITICAL) if (new RegExp(word, 'i').test(name)) reasons.push('safety-critical keyword "' + word + '" in the design');
  return { status: reasons.length ? 'HUMAN_REVIEW_REQUIRED' : 'OK', required: reasons.length > 0, reasons };
}