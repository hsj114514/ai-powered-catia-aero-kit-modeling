// SPDX-License-Identifier: GPL-3.0-only
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { apiCatalog } from './gsd-api.js';
import { commandCatalog } from './gsd-commands.js';
const resources=['skills/global_aero_design.md','skills/front_wing_design.md','rules/fsec_rules.json','rules/geometry_policy.json','rules/source_2026_geometry.json','scoring/global_metrics.json','scoring/front_wing_weights.json','CHARTER.md','lib/prompt.js','lib/gsd-catalog.json','lib/policy-status.js','lib/planning-policy.js','lib/evaluator.js','lib/habit-priors.js','lib/tools.js','index.js','lib/gsd-api.js','lib/solid-ops.js','lib/vbs.js','lib/ops.js','lib/catia/index.js','lib/catia/part-design.js','lib/sketch-input.js','lib/plan-routing.js','lib/catia/sketcher.js','lib/bridge.js'];
export function policyStatus(settings={}) {
  const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const manifest=JSON.parse(read('package.json'));
  const commands=commandCatalog();
  return {version:manifest.version,revision:manifest.catiaAeroRevision,personaEnabled:settings.persona!==false,resources:resources.map(file=>({file,sha256:createHash('sha256').update(read(file)).digest('hex')})),sketcher:{status:'IMPLEMENTED_NOT_LIVE_VERIFIED',supported:['closed polygon','open straight polyline','native junction coincidence','length/horizontal/vertical/parallel/perpendicular constraints','parameter edit/rebuild','Sketcher-first straight-section routing','native endpoint and constraint-count readback'],unsupported:['arc sketch','curved airfoil sketch','full constraint solver','Pad/Pocket']},gsd:{factories:apiCatalog().operations.length,commands:commands.length,unsupportedCommands:commands.filter(c=>c.status==='NOT_IMPLEMENTED').map(c=>c.english)},scope:'Resource fingerprints and code coverage only; not proof that a host injected the persona or that CATIA licences/geometry work.'};
}
