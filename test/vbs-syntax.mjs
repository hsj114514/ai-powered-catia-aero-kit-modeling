// SPDX-License-Identifier: GPL-3.0-only
/** Parse generated VBScript in Windows Script Host, with EVERY build invocation disabled.
 * Only a temporary text report is written. No AttachCatia, GetObject or CAD factory executes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRELUDE, assembleScript } from '../lib/vbs.js';
import { elementFragment } from '../lib/ops.js';
import { apiElement } from '../lib/gsd-api.js';
const systemRoot=process.env.SystemRoot??process.env.WINDIR;
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(process.platform!=='win32'||!systemRoot) { console.log('SKIP: Windows Script Host parser unavailable on this platform.');process.exit(0); }
const temp=mkdtempSync(path.join(root,'syntax-scratch-'));
try {
 const elements=JSON.parse(readFileSync(new URL('../examples/r5-right-front-union.plan.json',import.meta.url))).steps;
 elements.push(...JSON.parse(readFileSync(new URL('../examples/r5-sketch-capped-front.plan.json',import.meta.url))).steps);
 elements.push(...JSON.parse(readFileSync(new URL('../examples/r5-axis-to-axis.plan.json',import.meta.url))).steps);
 const fragments=elements.map(e=>elementFragment(e));
 fragments.push(apiElement({id:'SyntaxDomain',params:{factory:'AddNewDatums',arguments:[{ref:'Input'}],domainIndex:1,expectedDomains:2}}));
 fragments.push(apiElement({id:'SyntaxMid',params:{factory:'AddNewMidSurface',arguments:[{ref:'Input'},0,5]}}));
 const procedures=[],disabled=[];
 for(const fragment of fragments) disabled.push(fragment.replace(/^Sub [\s\S]*?^End Sub\r?$/gm,s=>{procedures.push(s);return ''; }));
 const body=procedures.join('\n')+'\nIf False Then\n'+disabled.join('\n')+'\nEnd If';
 assert.ok(!disabled.join('\n').includes('AttachCatia'));
 const script=assembleScript({prelude:PRELUDE,body,reportPath:path.join(temp,'report.txt'),op:'offline-syntax',title:'Disabled geometry invocation'});
 const file=path.join(temp,'parse.vbs');writeFileSync(file,Buffer.concat([Buffer.from([255,254]),Buffer.from(script,'utf16le')]));
 const result=spawnSync(path.join(systemRoot,'System32','cscript.exe'),['//nologo',file],{encoding:'utf8',windowsHide:true,timeout:30000});
 if(result.error?.code==='ENOENT') { console.log('SKIP: cscript parser is unavailable.'); }
 else { assert.equal(result.status,0,result.stderr||result.stdout||result.error?.message);assert.match(readFileSync(path.join(temp,'report.txt'),'utf16le'),/RESULT\tok/);console.log('PASS: VBScript syntax parsed with all geometry invocations disabled; no CATIA connection.'); }
} finally {
 if(path.resolve(path.dirname(temp))!==path.resolve(root)) throw new Error('Unexpected scratch target');
 rmSync(temp,{recursive:true,force:true});
}
