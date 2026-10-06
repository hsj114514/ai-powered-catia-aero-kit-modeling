# AI-Powered CATIA Aero Kit Modeling

[中文说明](README.md) · **v1.1 / 1.1.0 · r6** · GPL-3.0-only

A CATIA V5 parametric modelling toolkit for race-car aerodynamic kits. **v1.1 adds component placement reading and assembly operations.** Source repository: [hsj114514/ai-powered-catia-aero-kit-modeling](https://github.com/hsj114514/ai-powered-catia-aero-kit-modeling).

## Features

- NACA/custom airfoils, wings, chained flaps, endplates, diffusers and reference geometry.
- Parameter ledgers, numbered model rebuilds, parameter rollback, audit records and exports.
- Offline STEP assembly structure and placements, CSV export and optional approximate envelopes.
- Absolute component placements composed through nested CATIA assemblies.
- Guarded component insertion, removal and replacement, with optional new CATProduct output.
- Screening of selected geometric limits from caller-supplied vehicle datums and regions.

Scope is geometry. Mounting stiffness, approximately 200 N load deformation, structural strength and aerodynamic performance are not evaluated.

## Requirements and portability

Offline modules require Node.js 18+ and use only built-in modules: no dependency installation or build. Live automation requires Windows, CATIA V5, a working COM interface and appropriate licences. The plugin entry requires a DSH/Cordis host providing the tools service.

Other agents need an adapter for the exported tool definitions or direct module integration. This package does not provide a generic MCP server. The internal package name remains `@local/catia-aero-kit`; `private: true` prevents accidental npm publication and does not prevent GitHub distribution.

After extracting the full directory, run:

```sh
node scripts/doctor.mjs
node scripts/checksums.mjs
```

On Windows, `powershell -NoProfile -File scripts/doctor.ps1` also checks script-host availability and CATIA COM registration. Diagnostics do not install software or start CATIA. Registration alone is not a live functionality check.

If Windows blocks an unsigned script, inspect its source and add `-ExecutionPolicy Bypass` to that invocation. This affects only that PowerShell process and does not change system policy. Node-based discovery requires no such parameter.

For DSH, import the extracted package directory using the host's `plugin_manager action: install_bundle, target: <absolute package directory>` interface; confirm syntax against the installed host version.

## Configuration and coordinates

The shipped `projectRoot: ''` automatically selects an absolute directory from LOCALAPPDATA, XDG_DATA_HOME, HOME/.local/share, TEMP, or the system temporary directory, then appends catia-aero-kit/projects. An explicit writable absolute root can override it. Back up projects if the temporary fallback is used.

Runtime maxLevel defaults to 2; the shipped configuration uses 3 to retain assembly removal/replacement. Level 3 also requires an exact instance-name confirmation and a reason, as well as actual human authorization.

Modelling coordinates are millimetres, +X aft, +Y up, +Z outboard. STEP values retain source units without automatic conversion. Resolve source units and vehicle datums before comparison.

Placement reading returns row-major 3×4 values:
`[r00,r01,r02,tx, r10,r11,r12,ty, r20,r21,r22,tz]`.

Assembly insertion takes CATIA axis components:
`[Xx,Xy,Xz, Yx,Yy,Yz, Zx,Zy,Zz, ox,oy,oz]`.
These representations are different. Inspect unresolved placements, depth/count truncation and envelope quality flags. The Chinese README contains complete tool-call examples.

## Assembly and rule limits

Assembly operations modify the current CATIA session. A later failure can leave it changed. Optional saveAs refuses existing output files; without it the change stays in the session. External references remain linked to source files: use CATIA Save Management to collect them for another machine.

Replacement preserves the previous local placement, but local frames, constraints and publications require inspection. Component origins do not establish geometric clearance.

STEP envelopes are approximate and always marked unsuitable for compliance certification. Spline/loft checks screen their input samples and may return PARTIAL_SUCCESS. Final surfaces, clearance and complete event compliance require measurement and the applicable official rules.

## Development and delivery

```sh
node scripts/verify.mjs
node scripts/geometry-check.mjs <ledger.json> <rules.json>
```

Geometry screening exits with 0 for selected exact geometry passing supplied checks, 2 for violations/incomplete screening, and 1 for invalid input/errors.

Windows archive creation: `powershell -NoProfile -File scripts/package.ps1 -OutputFile <new absolute zip path>`. The archive whitelist excludes generated reports, CAD files and local project data and includes a SHA256 manifest. Checksums detect changes, not publisher authenticity.

See [CHANGELOG](CHANGELOG.md), [release notes](RELEASE_NOTES.md), [portability record](PORTABILITY.md), [contributing](CONTRIBUTING.md) and [security](SECURITY.md). Historical review documents do not establish live verification for this candidate.

This preparation checks source syntax and delivery integrity. Regression suites and live CATIA verification were not run for this candidate.

## Licence

GNU GPL v3 only, **GPL-3.0-only**: see [LICENSE](LICENSE). External software is not bundled and retains its own licensing.
