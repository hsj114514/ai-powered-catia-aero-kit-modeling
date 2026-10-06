// SPDX-License-Identifier: GPL-3.0-only
/**
 * CATIA aerodynamic modelling plugin for DSH.
 *
 * Registers the safety-scoped `catia_*` tool set against a running CATIA V5 session and, unless
 * disabled, the charter section that governs how those tools may be used.
 *
 * The plugin deliberately exports no `Config` schema and imports nothing outside Node's standard
 * library: a workspace bundle that declares no dependencies installs into any profile without a
 * resolution step, and the effective settings are validated defensively in `normalizeSettings`.
 *
 * @module @local/catia-aero-kit
 */
import os from 'node:os';
import path from 'node:path';
import { CatiaBridge, normalizeSettings } from './lib/bridge.js';
import { buildPersona, SECTION_ORDER } from './lib/prompt.js';
import { buildToolDefinitions } from './lib/tools.js';

/** Cordis plugin name. */
export const name = 'catia-aero';

/** The service this plugin cannot work without. */
export const inject = ['tools'];

/**
 * Directory used when the loader row does not name a project root.
 *
 * `process.cwd()` is deliberately not used. A host process commonly runs from somewhere it cannot
 * write, such as a system installation directory, and the first `mkdir` then fails
 * with a bare EPERM on **every** project-scoped tool, including `catia_env`. A per-user data
 * directory normally permits writing; filesystem permissions are checked when used, and the effective root is reported by `catia_env`.
 *
 * @param env - environment to read (injectable for tests).
 * @param tmpdir - last-resort temporary directory.
 * @returns an absolute per-user project root.
 */
export function defaultProjectRoot(env = process.env, tmpdir = os.tmpdir()) {
  const usable = (value) => typeof value === 'string' && value.trim() !== '' && path.isAbsolute(value);
  const base = [env.LOCALAPPDATA, env.XDG_DATA_HOME, usable(env.HOME) ? path.join(env.HOME, '.local', 'share') : '', env.TEMP, tmpdir].find(usable);
  if (!base) throw new Error('No absolute user data directory is available; configure projectRoot');
  return path.join(base, 'catia-aero-kit', 'projects');
}

/**
 * Resolve the effective settings for a loader row config.
 *
 * Exported so the fallback wiring itself is testable: the defect this guards against was that
 * `apply()` computed the default root from `process.cwd()`, which no test exercised because `apply`
 * needs a Cordis context.
 *
 * @param config - the loader row's `config`, if any.
 * @returns the validated settings, including the effective `projectRoot`.
 */
export function resolveSettings(config) {
  return normalizeSettings(config, defaultProjectRoot());
}

/**
 * Register the CATIA tool set and the agent charter.
 * @param ctx - the plugin's Cordis context.
 * @param config - the loader row's `config`, if any.
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config);
  if (!settings.enabled) return;

  const bridge = new CatiaBridge(settings);

  /** Register a resource as an effect of this context, tolerating a context without `effect`. */
  const own = (register) => {
    if (typeof ctx.effect === 'function') {
      ctx.effect(register);
      return;
    }
    register();
  };

  for (const definition of buildToolDefinitions(bridge, settings)) {
    own(() => ctx.tools.register(definition));
  }

  const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined;
  if (settings.persona && systemPrompt && typeof systemPrompt.section === 'function') {
    own(() => systemPrompt.section({
      name: 'catia-aero/charter',
      order: SECTION_ORDER,
      text: buildPersona(settings),
    }));
  }
}
