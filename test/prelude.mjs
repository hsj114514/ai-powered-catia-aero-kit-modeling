/**
 * Parses and runs one generated script with `cscript.exe` to prove the shared preamble is legal
 * VBScript and that the report channel works.
 *
 * This is the guard for a whole class of defects that no amount of JavaScript-level checking
 * catches: the preamble is a string, so any illegal identifier, stray backtick-shaped token or
 * unbalanced block only shows up when Windows Script Host reads it. It spawns with
 * `stdio: 'ignore'` because a child of a sandboxed process cannot write to an inherited pipe.
 *
 * Run from the package directory:  node test/prelude.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleScript, ensurePrelude } from '../lib/vbs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, 'tmp');
mkdirSync(tmp, { recursive: true });

const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}${detail ? ` :: ${detail}` : ''}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

const report = path.join(tmp, 'prelude-report.tsv');
const scriptPath = path.join(tmp, 'prelude-check.vbs');
rmSync(report, { force: true });
rmSync(scriptPath, { force: true });

const script = assembleScript({
  prelude: ensurePrelude(),
  body: [
    'Emit "probeInt", 42',
    'Emit "probeText", "hello world"',
    'Emit "probeFloat", 1.5',
  ].join('\n'),
  reportPath: report,
  op: 'prelude-check',
  title: 'prelude check',
});
writeFileSync(scriptPath, script, 'utf8');

// VBScript identifiers must begin with a letter; the first version of this preamble used
// `__name` globals and Windows Script Host rejected the whole file with "invalid character".
const illegal = script.match(/(^|[\s(,=&])_[A-Za-z]/g);
check('preamble has no underscore-prefixed identifiers', illegal === null, illegal ? illegal.slice(0, 5).join(' ') : '');
check('preamble declares script-level error handling', /^On Error Resume Next$/m.test(script));
check('placeholders were substituted', !script.includes('@@'));
check('script was written', existsSync(scriptPath), scriptPath);

const cscript = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'cscript.exe')
  : 'cscript.exe';
const run = spawnSync(cscript, ['//nologo', '//B', scriptPath], { stdio: 'ignore', windowsHide: true });
check('cscript exited cleanly', run.status === 0, `status=${run.status} error=${run.error?.message ?? 'none'}`);
check('report file was produced', existsSync(report), report);

const values = {};
let result = null;
if (existsSync(report)) {
  for (const line of readFileSync(report, 'utf8').split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const tab = line.indexOf('\t');
    const key = tab === -1 ? line : line.slice(0, tab);
    const value = tab === -1 ? '' : line.slice(tab + 1);
    if (key === 'RESULT') result = value;
    else values[key] = value;
  }
}
check('script reported success', result === 'ok', `RESULT=${result}`);
check('integer value round-tripped', values.probeInt === '42', `got ${values.probeInt}`);
check('text value round-tripped', values.probeText === 'hello world', `got ${values.probeText}`);
check('float value round-tripped', values.probeFloat === '1.5', `got ${values.probeFloat}`);
check('report is tab separated', readFileSync(report, 'utf8').includes('probeInt\t42'));

lines.push('');
lines.push(failures === 0 ? 'ALL PRELUDE CHECKS PASSED' : `${failures} PRELUDE CHECK(S) FAILED`);
writeFileSync(path.join(here, 'prelude-report.txt'), `${lines.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;
