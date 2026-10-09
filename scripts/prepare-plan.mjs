// SPDX-License-Identifier: GPL-3.0-only
/** Offline candidate preparation. Never attaches to CATIA or writes a ledger. */
import {readFileSync,statSync,writeFileSync} from 'node:fs';
import {preparePlan} from '../lib/plan-routing.js';
import {evaluateBuildPlan,loadWeights} from '../lib/evaluator.js';
try {
  const [input,output,...extra]=process.argv.slice(2);
  if(!input||!output||extra.length)throw Error('Usage: node scripts/prepare-plan.mjs <input.plan.json> <new-output.plan.json>');
  if(statSync(input).size>8388608)throw Error('Plan exceeds 8 MiB');
  const plan=JSON.parse(readFileSync(input,'utf8').replace(/^\uFEFF/,''));
  const weights=loadWeights(new URL('../scoring/front_wing_weights.json',import.meta.url));
  const original=evaluateBuildPlan(plan,weights);
  if(!original.eligible)throw Error('Input rejected: '+JSON.stringify(original.rejects));
  const prepared=preparePlan(plan.steps);
  const candidate={...plan,steps:prepared.steps,dryRun:true,routeMode:'sketch_first',revision:'v1.2.0-r11-candidate',routing:prepared.changes};
  const evaluation=evaluateBuildPlan(candidate,weights);
  if(!evaluation.eligible)throw Error('Prepared input rejected: '+JSON.stringify(evaluation.rejects));
  writeFileSync(output,JSON.stringify(candidate,null,2)+'\n',{encoding:'utf8',flag:'wx'});
  console.log(JSON.stringify({status:'SUCCESS',output,changes:prepared.changes,routeAudit:prepared.routeAudit,nativeVerified:false,closure:evaluation.closure},null,2));
} catch(error){console.error(JSON.stringify({status:'BLOCKED',errors:[error.message]}));process.exitCode=1;}
