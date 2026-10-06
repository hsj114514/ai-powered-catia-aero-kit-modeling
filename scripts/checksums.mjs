// SPDX-License-Identifier: GPL-3.0-only
/** Verify the delivered file manifest without dependencies or filesystem changes. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
try {
  const rows = readFileSync(path.join(root, 'checksums.sha256'), 'utf8').trim().split(/\r?\n/);
  const seen = new Set();
  let failures = 0;
  for (const row of rows) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(row);
    if (!match) throw new Error('Malformed checksum manifest');
    const [, expected, relative] = match;
    const parts = relative.split('/');
    if (relative.includes('\\') || /[\u0000-\u001f:]/.test(relative)
      || parts.some(part => !part || part === '.' || part === '..') || seen.has(relative)) {
      throw new Error('Unsafe or duplicate checksum entry');
    }
    seen.add(relative);
    let target = root;
    try {
      for (const part of parts) {
        target = path.join(target, part);
        if (lstatSync(target).isSymbolicLink()) throw new Error('Symlinks are not supported');
      }
      const resolved = realpathSync(target);
      const relation = path.relative(root, resolved);
      if (!relation || relation === '..' || relation.startsWith('..' + path.sep) || path.isAbsolute(relation)) {
        throw new Error('Entry escapes package root');
      }
      if (!lstatSync(resolved).isFile()) throw new Error('Entry is not a file');
      const actual = createHash('sha256').update(readFileSync(resolved)).digest('hex');
      if (actual !== expected) throw new Error('SHA256 mismatch');
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${relative}: ${error.message}`);
    }
  }
  console.log(`${rows.length - failures}/${rows.length} listed files match the SHA256 manifest. Unlisted files and publisher identity are not checked.`);
  process.exitCode = failures ? 1 : 0;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
