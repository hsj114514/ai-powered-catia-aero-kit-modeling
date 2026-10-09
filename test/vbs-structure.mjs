// SPDX-License-Identifier: GPL-3.0-only
/**
 * v1.2.0 r7 - VBScript structural validation of the shipped prelude (NO child process).
 * A prelude syntax error kills every generated script before it can write a report, so this checks
 * the invariants a text-only test cannot see:
 *   1. no statement glued onto a block terminator without a ':' separator (the r6 regression),
 *   2. Sub/Function, For/Next, Do/Loop, Select/End Select balanced.
 * The detector is self-checked against synthetic good and bad lines, so a false negative fails here.
 * Real syntax checking needs cscript and cannot run inside the DSH sandbox (spawn EPERM).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const OPENERS = /^(If|For|Do|While|Select|Sub|Function|With|Else)\b/;
const STATEMENTS = /^(Set|Dim|Call|Exit|ReDim|Err\.|Next|Loop|End)\b/;
/** Returns a reason string when a block-terminator line carries a second statement, else null. */
export function gluedStatement(text) {
  const m = text.trim().match(/^(Next|Loop|Wend|End If|End Sub|End Function|End With|End Select)\s+(.+)$/);
  if (!m) return null;
  const rest = m[2].trim();
  if (rest.startsWith("'")) return null;
  if (/^[A-Za-z_]\w*$/.test(rest)) return null;            // "Next i" is a legal loop variable
  if (OPENERS.test(rest) || STATEMENTS.test(rest)) return text.trim().slice(0, 90);
  if (/^[A-Za-z_]\w*\s*(\[\s*\])?\s*=/.test(rest)) return text.trim().slice(0, 90);
  if (rest.includes(':')) return null;                     // an explicit separator is legal
  return OPENERS.test(rest) ? text.trim().slice(0, 90) : null;
}
// self-check: the detector must catch the exact r6 regression and must not cry wolf on valid lines
assert.ok(gluedStatement('    Next  If gFatal <> "" Then Exit Sub'), 'detector must flag a glued If');
assert.ok(gluedStatement('      End If  Set x = 1'), 'detector must flag a glued Set');
assert.equal(gluedStatement('    Next'), null, 'a bare Next is fine');
assert.equal(gluedStatement('    Next i'), null, 'Next with a loop variable is fine');
assert.equal(gluedStatement("    End If   ' comment"), null, 'a trailing comment is fine');
assert.equal(gluedStatement('    Next : x = 1'), null, 'an explicit separator is fine');

const src = readFileSync(new URL('../lib/vbs.js', import.meta.url), 'utf8');
const start = src.indexOf('export const PRELUDE = `');
const end = src.indexOf('`;', start + 20);
assert.ok(start >= 0 && end > start, 'PRELUDE template found');
const prelude = src.slice(start, end);
const lines = prelude.split(/\r?\n/);
const glued = [];
lines.forEach((line, i) => { const bad = gluedStatement(line); if (bad) glued.push('L' + (i + 1) + ': ' + bad); });
assert.deepEqual(glued, [], 'statements must not be glued onto a block terminator:\n' + glued.join('\n'));
const count = (re) => lines.filter((l) => re.test(l.trim()) && !l.trim().startsWith("'")).length;
for (const [name, open, close] of [
  ['Sub', /^Sub\s+\w+/, /^End Sub$/],
  ['Function', /^Function\s+\w+/, /^End Function$/],
  ['For', /^For\s+/, /^Next(?:\s|$)/],
  ['Do', /^Do(?:\s|$)/, /^Loop(?:\s|$)/],
  ['Select', /^Select\s+Case/, /^End Select$/],
]) {
  const o = count(open); const c = count(close);
  assert.equal(o, c, name + ' blocks unbalanced: ' + o + ' open vs ' + c + ' close');
}
assert.ok(!/lines\(i\)\.StartPoint\s*=/.test(prelude), 'the r6 removal must persist');
assert.ok(prelude.includes('Sub ReadSketchEnds')&&prelude.includes('a.GetCoordinates xy'), 'endpoint fallback must be a documented read, not a verification skip');
console.log('PASS: prelude structure - detector self-checked, no glued statements, blocks balanced (' + lines.length + ' lines), sketch fix intact.');