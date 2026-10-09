// SPDX-License-Identifier: GPL-3.0-only
/** Standalone offline routing/closure review. No bridge, CATIA call or installation. */
import {readFileSync,statSync} from 'node:fs';
import {evaluateBuildPlan,loadWeights} from '../lib/evaluator.js';
try {
  const [file,component='front_wing',...extra]=process.argv.slice(2);
  if(!file||extra.length||!['front_wing','global'].includes(component)) throw Error('Usage: node scripts/evaluate-plan.mjs <plan.json> [front_wing|global]');
  if(statSync(file).size>8388608) throw Error('Plan exceeds 8 MiB');
  const plan=JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const evaluation=evaluateBuildPlan(plan,loadWeights(new URL('../scoring/'+(component==='front_wing'?'front_wing_weights.json':'global_metrics.json'),import.meta.url)),{component});
  console.log(JSON.stringify(evaluation,null,2));
  process.exitCode=evaluation.eligible?0:1; // 0 means input eligible, never delivery-ready or native build success.
} catch(error) {console.error(JSON.stringify({status:'BLOCKED',errors:[error.message]}));process.exitCode=1;}
