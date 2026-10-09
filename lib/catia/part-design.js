// SPDX-License-Identifier: GPL-3.0-only
/** A partial capability facade, never a second native execution path. */
import { NotImplementedError } from './index.js';
import { apiCatalog } from '../gsd-api.js';
export const PART_DESIGN_STATUS = {fillets:'IMPLEMENTED_NOT_LIVE_VERIFIED',solids:'PARTIAL',note:'Native callers must use the registered whitelist. No Pad/Pocket or general Boolean adapter.'};
export function solidFeature(name) {
  const row=apiCatalog().operations.find(f=>f.owner==='ShapeFactory'&&f.method===name);
  if(!row) throw new NotImplementedError('part_design',name+' is not in the documented catalog');
  return row;
}
export function isSolidFeatureAvailable(name) {
  return apiCatalog().operations.some(f=>f.owner==='ShapeFactory'&&f.kind==='solid'&&(name===undefined||f.method===name));
}
