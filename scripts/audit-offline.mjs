// SPDX-License-Identifier: GPL-3.0-only
/** Offline suites and source syntax only. Optional --syntax disables all native geometry calls. */
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv=process.argv.slice(2);
if(argv.some(a=>a!=='--syntax')||argv.length>1) throw Error('Usage: node scripts/audit-offline.mjs [--syntax]');
const run=name=>{const r=spawnSync(process.execPath,[path.join(root,name)],{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000});if(r.error||r.status!==0)throw Error(r.error?.message??r.stdout+'\n'+r.stderr);return r.stdout.trim();};
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sources=['index.js',...['lib','scripts','test'].flatMap(dir=>walk(path.join(root,dir)).filter(f=>/\.(?:js|mjs)$/.test(f)).map(f=>path.relative(root,f)))];
for(const file of sources) {const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true,timeout:30000});if(r.error||r.status!==0)throw Error(file+': '+(r.error?.message??r.stderr));}
const suite=run('scripts/verify.mjs'),policy=run('test/r10-policy.mjs'),catalog=run('test/r3.mjs');
const scriptSyntax=argv.includes('--syntax')?run('test/vbs-syntax.mjs'):null;
const manifest=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
const report={version:manifest.version,revision:manifest.catiaAeroRevision,scope:'offline contracts and synthetic evidence fixtures',createdAt:new Date().toISOString(),nodeVersion:process.version,sourceSyntaxFiles:sources.length,suites:suite.split(/\r?\n/),policyRegression:policy,catalogContracts:catalog,generatedVbsSyntax:scriptSyntax,
 baseline:{version:'1.2.0',revision:'r9',offlineSuitesPassed:33,offlineSuitesTotal:33},liveCatiaRun:false,installed:false,githubPushed:false,
 D3:{rootCauseConfirmed:false,liveFixVerified:false},D4:{rootCauseConfirmed:false,liveFixVerified:false},endplateClosure:{nativeVerified:false,change:'closure obligations, actual repair-attempt tracking and chained Boolean Body cache; no native closure certification'},competitionRules:'Supplied 2026 geometric source map; official provenance unauthenticated, advisory competition entries remain UNVERIFIED; rigidity/load deformation out of scope',
 deliveryValidation:'ZIP integrity, file hashes and fresh extraction checked separately; ZIP SHA256 in external sidecar'};
writeFileSync(path.join(root,'offline-report-v1.2.0-'+manifest.catiaAeroRevision+'.json'),JSON.stringify(report,null,2)+'\n');
console.log(suite);console.log(policy);console.log('Source syntax: '+sources.length+' files');if(scriptSyntax)console.log(scriptSyntax);
