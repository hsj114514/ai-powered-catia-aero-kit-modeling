// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const global = readFileSync(new URL('../skills/global_aero_design.md', import.meta.url), 'utf8');
const fw = readFileSync(new URL('../skills/front_wing_design.md', import.meta.url), 'utf8');
const lower = global.toLowerCase();
for (const needle of ['Part A', 'Part B', 'Part C', 'q = 1/2 rho V^2', 'CL', 'CD', '|CL| / CD', 'Gap', 'Overlap', 'Rebuild Success', 'Evaluator']) assert.ok(lower.includes(needle.toLowerCase()), 'global skill missing: ' + needle);
for (const needle of ['Mainplane', 'Flap', 'Gap', 'Overlap', 'Endplate', '优先级', 'H10', '固定拓扑', 'Multi-Section Surface']) assert.ok(fw.includes(needle), 'front wing skill missing: ' + needle);
assert.ok(/权重.*scoring|scoring\/front_wing_weights/.test(fw), 'front wing skill must point weights at /scoring');
assert.ok(/Skill 负责设计理解/.test(global), 'global skill must state the responsibility split');
assert.ok(!/STAR-CCM|CFD 闭环|自动运行 CFD/i.test(global + fw), 'no CFD automation content is allowed in this stage');
console.log('PASS: both skills present with the required sections; weights delegated to /scoring; no CFD-automation content.');