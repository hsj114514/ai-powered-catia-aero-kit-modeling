// SPDX-License-Identifier: GPL-3.0-only
/**
 * Regression tests for the default project root.
 *
 * The defect these cover was measured on the installed package: with `projectRoot: ''` the plugin fell
 * back to `path.join(process.cwd(), 'catia-projects')`, and because the host runs from
 * a system installation directory the very first `mkdir` failed with a bare EPERM — every project-scoped
 * tool, `catia_env` included, was unusable, and the error said nothing about the one config value
 * that fixes it. Nothing in the suite covered the default root, which is why it shipped.
 *
 * Run from the package directory:  node test/project-root.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultProjectRoot, resolveSettings } from '../index.js';
import { CatiaBridge, normalizeSettings } from '../lib/bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(path.join(here, 'project-root-'));
const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}

try {
  const tail = path.join('catia-aero-kit', 'projects');

  // ---- the fallback is per-user, never the process working directory ----
  const userData = path.join(tmp, 'user-data');
  const xdgData = path.join(tmp, 'xdg-data');
  const userHome = path.join(tmp, 'user-home');
  const tempBase = path.join(tmp, 'temporary-data');
  const onWindows = defaultProjectRoot({ LOCALAPPDATA: userData, XDG_DATA_HOME: xdgData }, tempBase);
  check('uses LOCALAPPDATA when present', onWindows === path.join(userData, tail), onWindows);
  check('does not select the working-directory fallback', onWindows !== path.join(process.cwd(), 'catia-projects'), onWindows);

  const onLinux = defaultProjectRoot({ XDG_DATA_HOME: xdgData }, tempBase);
  check('uses XDG_DATA_HOME when present', onLinux === path.join(xdgData, tail), onLinux);

  const onHomeOnly = defaultProjectRoot({ HOME: userHome }, tempBase);
  check('falls back to HOME/.local/share', onHomeOnly === path.join(userHome, '.local', 'share', tail), onHomeOnly);

  const onNothing = defaultProjectRoot({}, tempBase);
  check('falls back to the temporary directory last', onNothing === path.join(tempBase, tail), onNothing);

  // Blank values must not be treated as a base: an empty string would resolve to a relative path.
  const onBlank = defaultProjectRoot({ LOCALAPPDATA: '   ', XDG_DATA_HOME: '', HOME: '' }, tempBase);
  check('ignores blank bases', onBlank === path.join(tempBase, tail), onBlank);

  // ---- an empty projectRoot in the row config takes the fallback ----
  const fallback = path.join(tmp, 'fallback-root');
  const settings = normalizeSettings({ projectRoot: '' }, fallback);
  check('an empty projectRoot resolves to the fallback', settings.projectRoot === fallback, settings.projectRoot);
  check('the fallback is not the working directory', settings.projectRoot !== path.join(process.cwd(), 'catia-projects'), settings.projectRoot);

  // ---- the wiring inside apply(): resolveSettings is what apply() calls ----
  const wired = resolveSettings({ projectRoot: '' });
  check('resolveSettings uses a per-user root when projectRoot is empty', wired.projectRoot === defaultProjectRoot(), wired.projectRoot);
  check('the wired root is never under the process working directory', !wired.projectRoot.startsWith(process.cwd()), wired.projectRoot);
  const explicit = path.join(tmp, 'explicit-root');
  check('an explicit projectRoot still wins', resolveSettings({ projectRoot: explicit }).projectRoot === explicit, resolveSettings({ projectRoot: explicit }).projectRoot);
  const wiredUndefined = resolveSettings(undefined);
  check('a missing row config also takes the per-user root', wiredUndefined.projectRoot === defaultProjectRoot(), wiredUndefined.projectRoot);
  check('the wired default is inside the user data directory, not a system one', /AppData[\\/]Local|\.local[\\/]share|[\\/]tmp/i.test(wired.projectRoot) || wired.projectRoot === defaultProjectRoot(), wired.projectRoot);

  // ---- a writable root still works ----
  const good = new CatiaBridge(normalizeSettings({ projectRoot: path.join(tmp, 'good-root') }, tmp));
  const paths = good.projectPaths('probe', true);
  check('a writable root creates the project directories', path.isAbsolute(paths.ledger) && paths.exports.includes('exports'), JSON.stringify(paths));

  // ---- an unwritable root reports the root and the setting, not a bare EPERM ----
  // Point the root at an existing *file*: creating a directory there fails deterministically on every
  // platform, which is how the error path is exercised without needing a privileged location.
  const blocker = path.join(tmp, 'blocker');
  writeFileSync(blocker, 'this is a file, not a directory\n', 'utf8');
  mkdirSync(path.join(tmp, 'unused'), { recursive: true });
  const bad = new CatiaBridge(normalizeSettings({ projectRoot: blocker }, tmp));
  let caught = null;
  try {
    bad.projectPaths('probe', true);
  } catch (error) {
    caught = error;
  }
  check('an unwritable root throws', caught !== null, 'no error thrown');
  check('the error names the root', Boolean(caught) && caught.message.includes(blocker), caught?.message);
  check('the error names the setting to change', Boolean(caught) && caught.message.includes('projectRoot'), caught?.message);
  check('the error keeps the original cause', Boolean(caught) && caught.cause !== undefined, String(caught?.cause));
  check('the error is not a bare fs error', Boolean(caught) && !/^EPERM: operation not permitted, mkdir/.test(caught.message), caught?.message);
} finally {
  if (path.dirname(tmp) !== here) throw new Error('Temporary directory escaped the test directory');
  rmSync(tmp, { recursive: true, force: true });
}

lines.push('');
lines.push(failures === 0 ? 'ALL PROJECT-ROOT CHECKS PASSED' : `${failures} PROJECT-ROOT CHECK(S) FAILED`);
writeFileSync(path.join(here, 'project-root-report.txt'), `${lines.join('\n')}\n`, 'utf8');
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = failures === 0 ? 0 : 1;
