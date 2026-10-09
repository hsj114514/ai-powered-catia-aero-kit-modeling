// SPDX-License-Identifier: GPL-3.0-only
/**
 * CATIA bridge: the only place that touches the filesystem and the Windows Script Host.
 *
 * Every CATIA operation in this plugin is executed the same way: a generated VBScript is
 * handed to `cscript.exe`, which drives the running CATIA session through its COM
 * automation interface. The script never writes to stdout (the DSH sandbox terminates a
 * child that writes to an inherited pipe) and never calls `TextStream.Flush` (the sandbox
 * terminates the script on that call); progress and results are appended to a report file
 * one open/write/close cycle at a time, so a script that dies still leaves its evidence.
 *
 * @module lib/bridge
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { ensurePrelude, assembleScript } from './vbs.js';

/** Operation risk levels. Levels gate what the plugin will execute at all. */
export const LEVEL = {
  READ: 0,
  REFERENCE: 1,
  MODIFY: 2,
  DESTRUCTIVE: 3,
  EXTERNAL: 4,
};

/** Human labels used in tool output and audit records. */
export const LEVEL_LABEL = {
  0: 'Level 0 read-only',
  1: 'Level 1 low-risk reversible',
  2: 'Level 2 modify existing design',
  3: 'Level 3 high-risk',
  4: 'Level 4 irreversible/external',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  projectRoot: '',
  maxLevel: 2,
  allowOverwrite: false,
  allowDeleteOwnFeature: true,
  scriptTimeoutMs: 900000,
  persona: true,
  verboseAudit: true,
};

/** Scratch project used by tools that must work before any design project exists. */
export const SCRATCH_PROJECT = '_scratch';

/**
 * Normalize the plugin row's `config`. Unknown keys are dropped and every value is clamped
 * to a safe range, because a malformed row must not be able to widen the plugin's authority.
 * @param raw - the loader row config, or undefined.
 * @param fallbackRoot - directory used when the row does not name a project root.
 * @returns the effective settings.
 */
export function normalizeSettings(raw, fallbackRoot) {
  const input = raw && typeof raw === 'object' ? raw : {};
  if (typeof input.projectRoot === 'string' && input.projectRoot.trim() && !path.isAbsolute(input.projectRoot)) throw new Error('projectRoot must be an absolute directory');
  const maxLevelRaw = Number(input.maxLevel);
  const timeoutRaw = Number(input.scriptTimeoutMs);
  return {
    enabled: input.enabled === false ? false : DEFAULT_SETTINGS.enabled,
    projectRoot: typeof input.projectRoot === 'string' && input.projectRoot.trim() !== ''
      ? path.resolve(input.projectRoot)
      : fallbackRoot,
    maxLevel: Number.isFinite(maxLevelRaw)
      ? Math.max(0, Math.min(4, Math.trunc(maxLevelRaw)))
      : DEFAULT_SETTINGS.maxLevel,
    allowOverwrite: input.allowOverwrite === true,
    allowDeleteOwnFeature: input.allowDeleteOwnFeature === false ? false : true,
    scriptTimeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw >= 10000
      ? Math.min(3600000, Math.trunc(timeoutRaw))
      : DEFAULT_SETTINGS.scriptTimeoutMs,
    persona: input.persona === false ? false : true,
    verboseAudit: input.verboseAudit === false ? false : true,
  };
}

/**
 * Guard a caller-supplied name so it can never escape the project directory.
 * @param value - raw name.
 * @param label - what the name is, for the error message.
 * @returns the trimmed name.
 */
export function safeName(value, label) {
  const text = String(value ?? '').trim();
  if (text === '') throw new Error(`${label} must not be empty`);
  if (text.length > 96) throw new Error(`${label} must be at most 96 characters`);
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(text)) throw new Error(`${label} must not contain path or control characters`);
  if (/[. ]$/.test(text) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(text) || ['__proto__', 'constructor', 'prototype'].includes(text)) throw new Error(`${label} is not a portable project or element name`);
  if (text === '.' || text === '..') throw new Error(`${label} must not be a relative path segment`);
  return text;
}

/**
 * Resolve a path that must stay inside a root directory.
 * @param root - the containing directory.
 * @param parts - relative path segments, each already free of separators.
 * @returns the absolute resolved path.
 */
export function inside(root, ...parts) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  const rel = path.relative(resolvedRoot, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`refusing to touch a path outside the project root: ${target}`);
  }
  let cursor = resolvedRoot;
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`refusing project symlink or junction: ${cursor}`); } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  return target;
}

/** Serializes CATIA access: one automation script may drive one CATIA session at a time. */
let queue = Promise.resolve();

/**
 * Run `task` after every previously queued bridge task settles.
 * @param task - the exclusive section.
 * @returns the task's result.
 */
function exclusive(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * The plugin's CATIA automation client.
 */
export class CatiaBridge {
  /**
   * @param settings - normalized settings from {@link normalizeSettings}.
   */
  constructor(settings) {
    this.settings = settings;
    this.scriptSeq = 0;
  }

  /** @returns the resolved project root directory. */
  get root() {
    return this.settings.projectRoot;
  }

  /**
   * Validate a project name and return its directories, creating them on demand.
   * @param project - caller-supplied project name.
   * @param create - whether the directories should be created.
   * @returns the project's directory set.
   */
  projectPaths(project, create = true) {
    const name = safeName(project ?? SCRATCH_PROJECT, 'project');
    const dir = inside(this.root, name);
    const support = path.join(dir, '.dsh-catia');
    const paths = {
      name,
      dir,
      ledger: path.join(dir, 'ledger.json'),
      audit: path.join(dir, 'audit.jsonl'),
      scripts: path.join(support, 'scripts'),
      reports: path.join(support, 'reports'),
      exports: path.join(dir, 'exports'),
    };
    for (const candidate of [paths.ledger, paths.audit, paths.scripts, paths.reports, paths.exports]) inside(this.root, path.relative(this.root, candidate));
    if (create) {
      try {
        for (const dir2 of [dir, support, paths.scripts, paths.reports, paths.exports]) {
          mkdirSync(dir2, { recursive: true });
        }
      } catch (error) {
        // A bare EPERM here reads as a plugin failure and gives no hint that the fix is one config
        // value. Name the root and the setting instead, and keep the original code for diagnosis.
        throw new Error(
          `project root "${this.root}" is not writable (${error?.code ?? 'unknown error'}: ${error?.message ?? ''}); `
          + 'set projectRoot in the plugin configuration to a writable directory',
          { cause: error },
        );
      }
    }
    return paths;
  }

  /**
   * Read a project ledger, or null when the project has no committed design yet.
   * @param project - caller-supplied project name.
   * @returns the ledger object, or null.
   */
  readLedger(project) {
    const paths = this.projectPaths(project, false);
    if (!existsSync(paths.ledger)) return null;
    try {
      const parsed = JSON.parse(readFileSync(paths.ledger, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      throw new Error(`project ledger is unreadable: ${paths.ledger} (${error.message})`);
    }
  }

  /**
   * Write a project ledger.
   * @param project - caller-supplied project name.
   * @param ledger - the complete ledger object.
   */
  writeLedger(project, ledger) {
    const paths = this.projectPaths(project, true);
    ledger.updatedAt = new Date().toISOString();
    const tempPath = `${paths.ledger}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      renameSync(tempPath, paths.ledger);
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  }

  /**
   * Create a fresh ledger for a project.
   * @param project - caller-supplied project name.
   * @param constraints - hard design constraints carried with the project.
   * @returns the new ledger.
   */
  initLedger(project, constraints = {}) {
    const ledger = {
      schema: 1,
      project: safeName(project, 'project'),
      units: 'mm',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 0,
      openDesign: null,
      constraints,
      elements: {},
      versions: [],
    };
    this.writeLedger(project, ledger);
    return ledger;
  }

  /**
   * Apply a mutation to a project ledger and persist it.
   * @param project - caller-supplied project name.
   * @param mutate - receives the ledger and returns the value to hand back.
   * @returns the mutation's return value.
   */
  withLedger(project, mutate) {
    const paths = this.projectPaths(project, true);
    let ledger = this.readLedger(project);
    if (!ledger) ledger = this.initLedger(project);
    const result = mutate(ledger);
    this.writeLedger(project, ledger);
    void paths;
    return result;
  }

  /**
   * Append one audit record to the project's audit journal.
   * @param project - caller-supplied project name.
   * @param entry - the record; `at` is filled in when absent.
   */
  audit(project, entry) {
    const paths = this.projectPaths(project, true);
    const record = { at: new Date().toISOString(), ...entry };
    appendFileSync(paths.audit, `${JSON.stringify(record)}\n`, 'utf8');
  }

  /**
   * Read the tail of a project's audit journal.
   * @param project - caller-supplied project name.
   * @param limit - maximum number of records, newest last.
   * @returns the parsed records.
   */
  readAudit(project, limit = 25) {
    const paths = this.projectPaths(project, false);
    if (!existsSync(paths.audit)) return [];
    const lines = readFileSync(paths.audit, 'utf8').split('\n').filter((line) => line.trim() !== '');
    const tail = lines.slice(Math.max(0, lines.length - Math.max(1, limit)));
    return tail.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { at: null, tool: 'unknown', raw: line };
      }
    });
  }

  /**
   * Pick a file name that does not exist yet, honouring the no-silent-overwrite rule.
   * @param dir - containing directory.
   * @param base - desired base name without extension.
   * @param ext - extension including the dot.
   * @returns the absolute path that is free to write.
   */
  freePath(dir, base, ext) {
    mkdirSync(dir, { recursive: true });
    const first = path.join(dir, `${base}${ext}`);
    if (this.settings.allowOverwrite || !existsSync(first)) return first;
    for (let index = 1; index < 1000; index += 1) {
      const candidate = path.join(dir, `${base}_Agent${String(index).padStart(2, '0')}${ext}`);
      if (!existsSync(candidate)) return candidate;
    }
    throw new Error(`no free file name left for ${base}${ext} in ${dir}`);
  }

  /**
   * List the files a project has produced, newest first.
   * @param project - caller-supplied project name.
   * @returns file names grouped by directory.
   */
  listOutputs(project) {
    const paths = this.projectPaths(project, false);
    const read = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : []);
    return {
      projectDir: paths.dir,
      parts: read(paths.dir).filter((f) => /\.(CATPart|CATProduct)$/i.test(f)),
      exports: read(paths.exports),
    };
  }

  /**
   * Run one generated CATIA script and read back its report.
   * @param options - script assembly inputs and audit metadata.
   * @returns the parsed execution outcome.
   */
  async run(options) {
    const { project, op, level, body, title, timeoutMs } = options;
    const effectiveLevel = Number.isFinite(level) ? level : LEVEL.REFERENCE;
    if (effectiveLevel > this.settings.maxLevel) {
      const message = `refused: ${op} is ${LEVEL_LABEL[effectiveLevel]}, above the configured ceiling ${LEVEL_LABEL[this.settings.maxLevel]}`;
      this.audit(project, { tool: op, level: effectiveLevel, status: 'blocked', reason: message });
      return { ok: false, blocked: true, message, op, level: effectiveLevel, errors: [message], values: {}, lists: {}, messages: [], durationMs: 0 };
    }
    if (!this.settings.allowDeleteOwnFeature && options.usesDelete) {
      const message = 'refused: deleting agent-created features is disabled by configuration';
      this.audit(project, { tool: op, level: effectiveLevel, status: 'blocked', reason: message });
      return { ok: false, blocked: true, message, op, level: effectiveLevel };
    }

    if (process.platform !== 'win32') return { ok: false, blocked: true, message: 'Live CATIA automation requires Windows and a registered CATIA V5 COM server', errors: ['Live CATIA automation requires Windows'], values: {}, lists: {}, messages: [], durationMs: 0 };
    const paths = this.projectPaths(project, true);
    this.scriptSeq += 1;
    const stamp = `${Date.now()}-${String(this.scriptSeq).padStart(3, '0')}-${randomUUID()}`;
    const scriptPath = path.join(paths.scripts, `${stamp}-${op}.vbs`);
    const reportPath = path.join(paths.reports, `${stamp}-${op}.tsv`);
    const source = assembleScript({
      prelude: ensurePrelude(),
      body,
      reportPath,
      op,
      title: title ?? op,
    });
    writeFileSync(scriptPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]), { flag: 'wx' });

    const started = Date.now();
    const outcome = await exclusive(() => this.spawnScript(scriptPath, timeoutMs ?? this.settings.scriptTimeoutMs));
    const report = this.readReport(reportPath);
    const durationMs = Date.now() - started;
    const ok = outcome.exitCode === 0 && report.result === 'ok';
    const errors = outcome.spawnError
      ? [...report.errors, `could not start CATIA script host: ${outcome.spawnError}`]
      : report.errors;
    if (outcome.exitCode !== 0 && errors.length === 0) errors.push(`Windows script host exited with code ${outcome.exitCode} before reporting a CATIA result; check script-host permissions, generated-script syntax and the CATIA session.`);
    const auditEntry = {
      runId:stamp,
      buildFingerprint:options.buildFingerprint,
      routing:options.routing??null,
      tool: op,
      level: effectiveLevel,
      status: ok ? 'ok' : outcome.timedOut ? 'timeout' : 'failed',
      durationMs,
      script: path.relative(paths.dir, scriptPath),
      exitCode: outcome.exitCode,
      steps: report.messages,
      errors,
      args: this.settings.verboseAudit ? options.auditArgs ?? undefined : undefined,
      // Only keys that appeared once are a faithful summary. A repeated key (bodies, features) is
      // preserved in the report file and must not be collapsed into a misleading single value.
      result: Object.fromEntries(
        Object.entries(report.values).filter(([key]) => (report.lists[key]?.length ?? 0) <= 1),
      ),
    };
    this.audit(project, auditEntry);
    return {
      runId:stamp,
      ok,
      op,
      level: effectiveLevel,
      exitCode: outcome.exitCode,
      timedOut: Boolean(outcome.timedOut),
      durationMs,
      messages: report.messages,
      errors,
      values: report.values,
      lists: report.lists,
      report: path.relative(paths.dir, reportPath),
      script: path.relative(paths.dir, scriptPath),
      note: outcome.timedOut
        ? 'CATIA did not finish in time; the script was terminated and CATIA may still be busy.'
        : undefined,
    };
  }

  /**
   * Spawn `cscript.exe` on a generated script with no stdio pipes.
   * @param scriptPath - the script to execute.
   * @param timeoutMs - hard limit on the automation run.
   * @returns exit status.
   */
  spawnScript(scriptPath, timeoutMs) {
    const cscript = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, 'System32', 'cscript.exe')
      : 'cscript.exe';
    return new Promise((resolve) => {
      let settled = false;
      const child = spawn(cscript, ['//nologo', '//B', scriptPath], {
        stdio: 'ignore',
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill();
        } catch {
          /* the child is already gone */
        }
        resolve({ exitCode: null, timedOut: true });
      }, Math.max(10000, timeoutMs));
      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: -1, timedOut: false, spawnError: error.message });
      });
      child.on('exit', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? -1, timedOut: false });
      });
    });
  }

  /**
   * Parse a generated script's tab-separated report.
   *
   * A key may legitimately repeat — a tree dump reports many bodies and features — so every value
   * is also collected in `lists`. Collapsing repeats into a single `values` entry would let the
   * agent believe a thirteen-feature model has one feature.
   *
   * @param reportPath - the report file the script appended to.
   * @returns the structured report.
   */
  readReport(reportPath) {
    const out = { result: 'missing', values: {}, lists: {}, messages: [], errors: [] };
    if (!existsSync(reportPath)) return out;
    const bytes = readFileSync(reportPath);
    const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() === '') continue;
      const tab = line.indexOf('\t');
      const key = tab === -1 ? line : line.slice(0, tab);
      const value = tab === -1 ? '' : line.slice(tab + 1);
      switch (key) {
        case 'RESULT':
          out.result = value;
          break;
        case 'ERROR':
          out.errors.push(value);
          break;
        case 'FAILSTEP':
          out.errors.push(value);
          break;
        case 'MSG':
          out.messages.push(value);
          break;
        default:
          out.values[key] = value;
          if (out.lists[key] === undefined) out.lists[key] = [];
          out.lists[key].push(value);
      }
    }
    return out;
  }
}
