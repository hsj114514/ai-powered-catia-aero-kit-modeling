// SPDX-License-Identifier: GPL-3.0-only
/** Standalone geometry screening: node scripts/geometry-check.mjs ledger.json [rules.json] */
import { readFileSync, statSync } from 'node:fs';
import { checkGeometryRules } from '../lib/rules.js';

function readJson(file) {
  if (statSync(file).size > 8 * 1024 * 1024) throw new Error('JSON input exceeds 8 MiB');
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
try {
  const [ledgerFile, rulesFile] = process.argv.slice(2);
  if (!ledgerFile) throw new Error('Usage: node scripts/geometry-check.mjs ledger.json [rules.json]');
  const ledger = readJson(ledgerFile);
  if (!ledger?.elements || Array.isArray(ledger.elements) || typeof ledger.elements !== 'object') throw new Error('ledger must contain an elements object');
  const result = checkGeometryRules(ledger, { rules: rulesFile ? readJson(rulesFile) : undefined }, ledger.project ?? 'offline');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'SUCCESS' ? 0 : result.status === 'PARTIAL_SUCCESS' ? 2 : 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'BLOCKED', errors: [error.message] }));
  process.exitCode = 1;
}
