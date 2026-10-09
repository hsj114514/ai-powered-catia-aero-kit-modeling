// SPDX-License-Identifier: GPL-3.0-only
/** Explicit live CATIA regression. No installation; only independent documents are created. */
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CatiaBridge, normalizeSettings } from '../lib/bridge.js';
import { elementFragment } from '../lib/ops.js';
import { gsdElement, probeBody, GSD_OPS } from '../lib/solid-ops.js';
import { buildToolDefinitions } from '../lib/tools.js';

const argv = process.argv.slice(2);
const outputIndex = argv.indexOf('--output');
const requested = outputIndex < 0 ? '' : argv[outputIndex + 1];
if (process.platform !== 'win32' || !argv.includes('--live') || !requested
  || !path.isAbsolute(requested) || !existsSync(requested) || !lstatSync(requested).isDirectory()
  || argv.length !== 3 || outputIndex !== 1 || argv[0] !== '--live') {
  console.error('Usage on Windows: node scripts/verify-live.mjs --live --output <existing writable absolute directory>');
  console.error('This explicitly starts/connects CATIA, creates separate test documents and saves test CAD. Save your work first.');
  process.exit(2);
}
const output = mkdtempSync(path.join(realpathSync(requested), 'catia-aero-r7-live-'));
const settings = normalizeSettings({ projectRoot: output, maxLevel: 1, scriptTimeoutMs: 120000 }, output);
const bridge = new CatiaBridge(settings);
const report = { version: '1.2.0', revision: 'r10', at: new Date().toISOString(), checks: [], results: {},
  scope: 'Legacy seven-operation specimens only; not the 139 r3 adapters, arbitrary-geometry, G2, assembly or competition-rule certification.' };
function check(name, passed, detail) {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
}
const near = (actual, expected) => Number.isFinite(Number(actual)) && Math.abs(Number(actual)-expected) <= Math.max(0.01,expected*1e-6);
// Appended only to test bodies that create their own document through NewDocument.
// Never locate/close a pre-existing document by name, index or active-document status.
const cleanup = `
If Not gDoc Is Nothing Then
  If gFatal <> "" And Not gKeepGeometry Then RollbackTrash
  Err.Clear
  gDoc.Close
  If Err.Number <> 0 Then
    Emit "liveCleanupError", Err.Description
  Else
    Emit "liveClosed", "true"
  End If
  Err.Clear
  Set gDoc = Nothing
  Set gTrash = CreateObject("Scripting.Dictionary")
End If`;
try {
  const plate = { id:'plate', kind:'endplate', params:{outlinePoints:[[0,0],[300,0],[300,120],[0,120]], thickness:2, z:0} };
  const flat = await bridge.run({project:'flat',op:'live_flat',level:1,body:[
    'AttachCatia', 'NewDocument', elementFragment(plate),
    gsdElement({id:'solid',kind:'gsd',params:{op:'solid_close',from:'plate'}}), cleanup,
  ].join('\n')});
  report.results.flat = flat;
  check('flat geometry updated',flat.ok,flat.errors);
  for (const face of ['front','back']) check('flat '+face+' area',near(flat.values['areaMm2_plate__'+face],36000),flat.values['areaMm2_plate__'+face]);
  check('flat closed-shell area',near(flat.values.areaMm2_plate,73680),flat.values.areaMm2_plate);
  check('flat solid volume',near(flat.values.volumeMm3_solid,72000),flat.values.volumeMm3_solid);
  check('flat document closed',flat.values.liveClosed==='true' && !flat.values.liveCleanupError);

  console.log('Running seven isolated GSD specimens...');
  const probe = await bridge.run({project:'probe',op:'live_probe',level:1,body:probeBody()});
  report.results.probe = probe;
  check('probe script completed',probe.ok,probe.errors);
  for (const op of Object.keys(GSD_OPS)) {
    check('probe '+op,probe.values['api_'+op]==='verified',probe.values['api_'+op]);
    check('probe '+op+' closed',probe.values['probeClosed_'+op]==='true');
  }
  check('probe cleanup',!(probe.lists.probeCleanupError?.length));
  // values contains the last repeated key; lists preserves the extrusion trial before helpers.
  check('probe line extrusion area',near(probe.lists.areaMm2_probe_extrude?.[0],200),probe.lists.areaMm2_probe_extrude);
  for (const [key,expected] of Object.entries({areaMm2_probe_face:400,areaMm2_probe_offset:400,areaMm2_probe_loft:200,areaMm2_probe_join:1200,volumeMm3_probe_thick:400,volumeMm3_probe_closed:4000})) {
    check('probe measurement '+key,near(probe.values[key],expected),probe.values[key]);
  }

  const args = JSON.parse(readFileSync(new URL('../examples/complex-endplate.json',import.meta.url),'utf8'));
  args.project = 'complex';
  const run = bridge.run.bind(bridge);
  let complexOutcome;
  bridge.run = async options => (complexOutcome = await run({...options,body:options.body+cleanup}));
  const plan = buildToolDefinitions(bridge,settings).find(tool=>tool.name==='catia_model_plan');
  const dry = await plan.execute({...args,dryRun:true});
  report.results.dryRun = dry;
  check('complex dry run',dry.status==='SUCCESS' && !existsSync(path.join(output,args.project)),dry);
  const complex = await plan.execute(args);
  report.results.complex = complex;
  check('complex batch saved',complex.status==='SUCCESS' && complex.version===1 && complex.geometryVerified===true,complex.errors);
  for (const id of ['panel','flare','retention_strip','endplate_sheet']) {
    check('complex '+id+' surface',complex.measurements?.[id]?.areaMm2>0,complex.measurements?.[id]);
  }
  check('complex solid volume',complex.measurements?.endplate_solid?.volumeMm3>0,complex.measurements?.endplate_solid);
  report.results.complexBridge = complexOutcome;
  check('complex document closed',complexOutcome?.values.liveClosed==='true' && !complexOutcome?.values.liveCleanupError);
  const ledger = bridge.readLedger(args.project);
  check('complex one version',ledger?.versions.length===1);
  const env = buildToolDefinitions(bridge,settings).find(tool=>tool.name==='catia_env');
  const envResult = await env.execute({project:'env',checkWrite:true});
  report.results.environment = envResult;
  report.results.environmentBridge = complexOutcome;
  check('write probe saved',envResult.status==='SUCCESS' && envResult.metrics.canWriteFiles.startsWith('yes'),envResult);
  check('write probe level',envResult.level===1);
  check('write probe document closed',complexOutcome?.values.writeProbeClosed==='true');
  check('write probe own file removed',complexOutcome?.values.saved && !existsSync(complexOutcome.values.saved));
} catch (error) {
  check('live runner exception',false,error.message);
} finally {
  report.passed = report.checks.every(item=>item.passed);
  writeFileSync(path.join(output,'live-result.json'),JSON.stringify(report,null,2)+'\n','utf8');
  console.log('Evidence directory: '+output);
  process.exitCode = report.passed ? 0 : 1;
}
