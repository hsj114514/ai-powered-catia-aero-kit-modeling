# AI-Powered CATIA Aero Kit Modeling

**v1.2.0 / r11 · GPL-3.0-only · GitHub version update**

[中文说明](README.md) · [Release notes](RELEASE_NOTES.md) · [Known issues and goals](ROADMAP.md)

A CATIA V5 parametric modelling toolkit for FSEC/FSAE aerodynamic components. It includes wing/flap/endplate/diffuser generators, component placement reading, assembly operations, GSD adapters, straight-line Sketcher support, plan preparation and geometric rule screening.

## Author's note

Original wording, retained at the author's request:

> 全题目光向我看齐，看我看我，我宣布个事，我是个sb，gsd的功能v1.2才想起来加

There is still substantial room to improve modelling: the Agent often prefers splines, does not establish enough useful constraints proactively, and can leave required surfaces open. It is usable for some work, but complex endplates still need inspection and adjustment. Improving these issues before v1.3 is a goal, not a guaranteed release commitment.

The quote is self-deprecating commentary. Basic spline/loft paths existed in v1.1, and GSD was expanded during v1.1.1; v1.2 consolidates broader adapters, catalogs and planning policies.

## Changes from v1.1

Compared with the saved v1.1.0/r6 GitHub candidate: **27 → 44 registered tools; 17 added, none removed**. Placement reading and assembly insert/remove/replace already existed in v1.1.

- 145 whitelisted factory adapters; 29 English/Chinese commands, 24 adapted and 5 explicitly unimplemented. Adapter coverage is not native validation.
- Straight polygon/open polyline sketches, length/direction/relation constraints, endpoint coincidence and native readback checks.
- Default sketch-first routing for exactly representable coplanar two-point line sections consumed by Loft; freeform curves are not automatically changed.
- Batch plans, dry runs, model review, task-based scoring, bounded habit bonuses, closure penalties and limited relief for relevant actual repair attempts.
- Global/front-wing design resources, rule provenance, deployment fingerprints and failure/rebuild diagnostics.
- Public documentation, offline CI and newly generated synthetic fixtures. Private CAD-derived outlines and historical live measurements are excluded.

## Quick start: offline

Node.js 18+; no npm runtime dependencies or build step. From the extracted catia-aero-kit folder:

```sh
node scripts/doctor.mjs
node scripts/checksums.mjs
node scripts/prepare-plan.mjs examples/r11-sketch-foot-input.plan.json prepared.plan.json
node scripts/evaluate-plan.mjs prepared.plan.json
node scripts/verify.mjs
```

The output plan must not already exist. These commands do not start CATIA or install the plugin. Doctor prints local paths; do not publish its output. See [public fixtures](examples/README.md); their arbitrary dimensions are not validated vehicle designs.

## Live use and compatibility

Live tools require Windows, CATIA V5, registered CATIA.Application COM and the relevant licences. The plugin targets DSH/Cordis with a tools service; injecting design resources also requires systemPrompt support. Other Agents need an adapter; this is not a standalone MCP server or universal installer.

See [deployment](REINSTALL_r11.md) and [portability](PORTABILITY.md). Replace the full package, then check catia_policy_status for 1.2.0/r11, 44 tools and 26 resource fingerprints. Updating Markdown alone does not update tools. The public bundle retains maxLevel:3 and remove/replace confirm/reason guards; setting it to2 disables those operations. Use authorised engineering copies.

A blank projectRoot resolves to a per-user output directory from environment variables; the script host is located through the system directory. No developer-specific absolute paths are embedded. Discovery does not install CATIA or verify licence availability.

## Boundaries

Default units: millimetres; +X rearward, +Y upward, +Z right/outboard. STEP retains source units without automatic conversion. Coordinate conversion must be explicit.

Open construction sections and intentional footplate openings are allowed. Required closed material boundaries must be declared and checked separately. A score, Join area or successful script Update does not independently certify overall closure, G2, aerodynamic performance or competition compliance.

Arc/airfoil sketches, tangent/radius sketch constraints, Pad/Pocket and full constraint certification are not implemented. Variable Offset, Rough Offset, Adaptive Sweep, Surface Simplification and Untrim remain unimplemented commands. D3 minimum-distance type mismatch and D4 section Update failure have no confirmed root cause or claimed native fix.

The current scope is geometry; it excludes mounting stiffness, deformation under approximately 200 N and automatic CFD. Tests are offline contracts, not real CATIA verification. The preparation snapshot was not installed or tested in CATIA. This source is used for the GitHub version update; CI results must be read from the actual workflow runs.

## More

[Sketch routing](R11_SKETCH_ROUTING.md) · [GSD commands](GSD_COMMANDS_v1.2.0-r5.md) · [Scoring](EVALUATOR_REFERENCE.md) · [Release review](GITHUB_RELEASE_REVIEW.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Licence](LICENSE)
