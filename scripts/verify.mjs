// SPDX-License-Identifier: GPL-3.0-only
/** Offline verification only: does not start CATIA or install dependencies. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tests = ['smoke', 'assembly', 'rules', 'tool-schema', 'envelope-regression', 'chain', 'assembly-write', 'project-root', 'r6'];
let failed = 0;
for (const test of tests) {
  let result = spawnSync(process.execPath, [path.join(root, 'test', test + '.mjs')], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  // A sandboxed parent cannot hand its child a pipe (EPERM): rerun with the child's output discarded.
  if (result.error && result.error.code === 'EPERM') {
    result = spawnSync(process.execPath, [path.join(root, 'test', test + '.mjs')], { cwd: root, stdio: 'ignore', windowsHide: true, timeout: 120000 });
    if (!result.error) result.stdout = '';
  }
  const passed = result.status === 0 && !result.error;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${test}`);
  if (!passed) { failed += 1; console.error(result.error?.message ?? result.stderr ?? result.stdout); console.error(result.stdout); }
}
console.log(`${tests.length - failed}/${tests.length} offline suites passed. Live CATIA and optional DSH compiler checks were not run.`);
process.exitCode = failed ? 1 : 0;
