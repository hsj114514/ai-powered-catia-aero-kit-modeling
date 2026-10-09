// SPDX-License-Identifier: GPL-3.0-only
/** Offline verification only: does not start CATIA or install dependencies. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tests = ['smoke', 'assembly', 'rules', 'tool-schema', 'envelope-regression', 'chain', 'assembly-write', 'project-root', 'r6', 'gsd-solid', 'r2', 'r3', 'schema', 'plan-file', 'r7', 'r8', 'gsd-chain', 'failure-taxonomy', 'rules-engine', 'evaluator', 'habits', 'sketcher', 'sketch-fix', 'vbs-structure', 'closure-boolean', 'complex-geometry', 'rebuild', 'skills', 'catia-kernel', 'history', 'human-review', 'r2-cross-review', 'r5-cross-review', 'r10-policy', 'r11-routing'];
let failed = 0, skipped = 0;
for (const test of tests) {
  let result = spawnSync(process.execPath, [path.join(root, 'test', test + '.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  // A sandboxed parent cannot hand its child a pipe (EPERM): rerun with the child's output discarded.
  if (result.error && result.error.code === 'EPERM') {
    result = spawnSync(process.execPath, [path.join(root, 'test', test + '.mjs')], { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 120000 });
    if (!result.error) result.stdout = '';
  }
  const passed = result.status === 0 && !result.error;
  const schemaReport = path.join(root, 'test', 'schema-report.txt');
  if (passed && test === 'schema' && existsSync(schemaReport) && readFileSync(schemaReport, 'utf8').startsWith('SKIPPED:')) {
    skipped += 1;
    console.log('SKIP schema: optional external DSH compiler unavailable');
    continue;
  }
  console.log(`${passed ? 'PASS' : 'FAIL'} ${test}`);
  if (!passed) { failed += 1; console.error(result.error?.message ?? result.stderr ?? result.stdout); console.error(result.stdout); }
}
console.log(`${tests.length - failed - skipped}/${tests.length - skipped} executed offline suites passed; ${skipped} optional suite(s) skipped. No live CATIA call.`);
process.exitCode = failed ? 1 : 0;
