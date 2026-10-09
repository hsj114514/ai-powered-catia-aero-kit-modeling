// SPDX-License-Identifier: GPL-3.0-only
/**
 * Failure taxonomy and hard-reject codes (v1.2.0 r1).
 * Classification is text-driven on real tool/CATIA messages, so every failure is attributable.
 */
export const FAILURE_CLASSES = {
  F1: 'TOOL_SCHEMA_FAILURE', F2: 'TOOL_NOT_IMPLEMENTED', F3: 'CATIA_API_FAILURE', F4: 'REFERENCE_FAILURE',
  F5: 'SURFACE_CONSTRUCTION_FAILURE', F6: 'TOPOLOGY_FAILURE', F7: 'UPDATE_FAILURE', F8: 'RULE_VIOLATION',
  F9: 'DESIGN_PLAN_FAILURE', F10: 'GSD_CAPABILITY_MISSING',
};
export const HARD_REJECT = {
  H01: 'official rule violation', H02: 'forbidden zone intrusion', H03: 'illegal geometry interference',
  H04: 'required geometry missing', H05: 'illegal parameter', H06: 'unrecoverable CATIA update failure',
  H07: 'illegal file write', H08: 'overwriting the only source file', H09: 'high-risk unknown script execution',
  H10: 'calling a tool/capability that does not exist or is not implemented',
};
const MATCHERS = [
  ['F10', /GSD_CAPABILITY_MISSING|GSD capability .*missing/i],
  ['F8', /\bH0[123]\b|official rule violation|RULE_VIOLATION/i],
  ['F1', /must be a .*number|is outside documented|unknown field|requires exactly|must be boolean|not a valid JSON Schema|additionalProperties/i],
  ['F2', /NOT_IMPLEMENTED|not implemented|no builder|unknown kind|factory is not in the documented whitelist|unsupported documented argument type/i],
  ['F4', /reference|not found|does not exist|unknown element|no ledger/i],
  ['F5', /AddNew(Fill|Loft|Sweep|Offset|Extrude|Join|CloseSurface) failed|Surface construction failed/i],
  ['F7', /UpdateObject|update failed|Update 失败|could not be built/i],
  ['F6', /not closed|non-manifold|self-intersection|topology/i],
  ['F3', /-2147467259|438|E_FAIL|类型不匹配|GetMinimumDistance failed|CATIA update failed/i],
  ['F9', /element id already exists|dependency|cycle|steps must contain|either steps or planFile/i],
];
export function classifyFailure(message = '') {
  for (const [code, re] of MATCHERS) if (re.test(String(message))) return code;
  return 'F3';
}
export function classifyMessage(message = '') { return FAILURE_CLASSES[classifyFailure(message)]; }
export function isHardReject(code) { return Object.prototype.hasOwnProperty.call(HARD_REJECT, code); }
export function hardReject(code, detail = '') {
  if (!isHardReject(code)) throw new Error('not a hard-reject code: ' + code);
  return { reject: true, code, reason: HARD_REJECT[code], detail, status: 'BLOCKED' };
}
