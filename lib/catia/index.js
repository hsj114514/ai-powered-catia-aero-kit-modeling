// SPDX-License-Identifier: GPL-3.0-only
/**
 * CATIA Geometry Kernel facade (v1.2.0 r1, spec section 5).
 *
 * The kernel is the single place that states WHICH CATIA responsibilities exist and WHERE the real
 * implementation lives. Agent code must go through this kernel (or the registered tools) and must
 * never generate ad-hoc CATIA COM/CAA code. A responsibility that has no implementation raises a
 * typed NOT_IMPLEMENTED error, which the failure taxonomy maps to F2/H10 - it is never simulated.
 */
export class NotImplementedError extends Error {
  constructor(capability, detail) { super('NOT_IMPLEMENTED: ' + capability + (detail ? ' - ' + detail : '')); this.name = 'NotImplementedError'; this.code = 'F2'; this.hardReject = 'H10'; this.capability = capability; }
}
const D = (implemented, where, note) => ({ implemented, where, note });
export const CATIA_KERNEL = {
  connection: D(true, 'lib/vbs.js (AttachCatia), lib/bridge.js', 'attaches to the running CATIA session; no new session is started'),
  document: D(true, 'lib/vbs.js (NewDocument, UseDocument, SaveAsChecked)', 'new document per version; source masters stay read-only'),
  parameters: D(true, 'lib/ops.js, lib/validation.js', 'element parameters validated before any filesystem write'),
  sketcher: D(true, 'lib/ops.js (sketchElement, kind sketch) + lib/vbs.js (MakeSketch)', 'documented Sketcher automation: Sketches.Add -> OpenEdition -> Factory2D -> Constraints -> CloseEdition; IMPLEMENTED but NOT live-verified in this revision'),
  gsd: D(true, 'lib/gsd-api.js (catalog-driven), lib/ops.js, lib/closed-solid.js', '145 documented factories; typed slots and enums enforced'),
  part_design: D(true, 'lib/solid-ops.js + lib/gsd-api.js', 'PARTIAL: CloseSurface/ThickSurface, documented fillets, Boolean Add, SewSurface and RemoveFace adapters. No Pad/Pocket/Hole/Shell/Draft/Pattern or general Boolean capability; inspect the catalog before use'),
  references: D(true, 'lib/vbs.js (BindFeature, BindInGeoset), lib/gsd-api.js', 'named references preferred over generated Edge/Face'),
  validation: D(true, 'lib/vbs.js (UpdateNow, VerifyFeature, MeasureFeatureArea), lib/model-review.js', 'update success plus positive measured area/volume'),
  file_safety: D(true, 'lib/bridge.js, lib/tools.js', 'new version file per iteration; existing files are never overwritten'),
  rollback: D(true, 'lib/vbs.js (RollbackTrash, CleanupFailedBuild), lib/tools.js', 'best-effort geometry rollback plus ledger restore'),
};
export function requireCapability(name) {
  const entry = CATIA_KERNEL[name];
  if (!entry) throw new NotImplementedError(name, 'unknown kernel responsibility');
  if (!entry.implemented) throw new NotImplementedError(name, entry.note);
  return entry;
}
export function kernelStatus() {
  const entries = Object.entries(CATIA_KERNEL);
  return { responsibilities: entries.length, implemented: entries.filter(([, v]) => v.implemented).length, missing: entries.filter(([, v]) => !v.implemented).map(([k2]) => k2), table: Object.fromEntries(entries) };
}