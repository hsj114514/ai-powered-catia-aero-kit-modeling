// SPDX-License-Identifier: GPL-3.0-only
/** Native line Sketcher adapter. Documented calls; this revision is not live verified. */
export const SKETCHER_STATUS='IMPLEMENTED / NOT_LIVE_VERIFIED';
export function isAvailable(){return true;}
export function planKind(){return 'sketch';}
export function documentedSequence(){return ['Body.Sketches.Add(plane)','Sketch.OpenEdition()','Factory2D.CreateLine(...)','Constraints.AddBiEltCst(catCstTypeOn=2,endpoint,endpoint)','Constraints.AddMonoEltCst(catCstTypeLength=5)','Constraints.AddMonoEltCst(horizontal=10/vertical=13)','Constraints.AddBiEltCst(parallel=8/perpendicular=11)','Constraint.Dimension.Value','Sketch.CloseEdition()','Part.UpdateObject','Curve2D.GetEndPoints or Point2D.GetCoordinates','Sketch.Constraints.Count','Constraint.Status'];}
export function limitations(){return ['straight closed polygons/open polylines only; no arcs/spline sketch adapter','length edits must match edited input points','no endpoint setters; documented getters are required for coincidence/readback','readback failure blocks verification rather than accepting stale bounds','underconstrained geometry is allowed; no full DOF certification','Pad/Pocket not implemented','not live-verified yet'];}
