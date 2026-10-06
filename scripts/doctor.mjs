// SPDX-License-Identifier: GPL-3.0-only
/** Read-only discovery using the same project-directory resolver as the plugin. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defaultProjectRoot } from '../index.js';

let projectRoot = null;
let projectRootError = null;
try { projectRoot = defaultProjectRoot(); }
catch (error) { projectRootError = error.message; }
const scriptHost = process.platform === 'win32' && process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'cscript.exe') : null;
const result = {
  nodePath: process.execPath,
  nodeVersion: process.version,
  nodeSupported: Number(process.versions.node.split('.')[0]) >= 18,
  platform: process.platform,
  defaultProjectRoot: projectRoot,
  projectRootError,
  scriptHost,
  scriptHostAvailable: Boolean(scriptHost && existsSync(scriptHost)),
  liveCatiaRequiresWindows: true,
  catiaComRegistrationChecked: false,
  note: 'Read-only discovery: no installation, directories created or CATIA started. Run doctor.ps1 on Windows for COM registration discovery. Live automation and host compatibility require separate verification.',
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.nodeSupported && !projectRootError ? 0 : 1;
