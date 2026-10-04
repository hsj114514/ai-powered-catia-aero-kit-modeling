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
import path from 'node:path';
import { CatiaBridge, normalizeSettings } from './lib/bridge.js';
import { buildPersona, SECTION_ORDER } from './lib/prompt.js';
import { buildToolDefinitions } from './lib/tools.js';

/** Cordis plugin name. */
export const name = 'catia-aero';

/** The service this plugin cannot work without. */
export const inject = ['tools'];

/**
 * Register the CATIA tool set and the agent charter.
 * @param ctx - the plugin's Cordis context.
 * @param config - the loader row's `config`, if any.
 */
export function apply(ctx, config) {
  const fallbackRoot = path.join(process.cwd(), 'catia-projects');
  const settings = normalizeSettings(config, fallbackRoot);
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
