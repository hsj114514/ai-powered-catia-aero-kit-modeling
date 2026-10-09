// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import {PRELUDE} from '../lib/vbs.js';
const body=PRELUDE.slice(PRELUDE.indexOf('Sub MakeSketch'));
assert.ok(!/lines\(i\)\.(StartPoint|EndPoint)\s*=/.test(body),'r5 endpoint setter failures must not recur');
assert.ok(body.includes('CreateLine(xs(i), ys(i), xs(j), ys(j))'));
assert.ok(PRELUDE.includes('geom.GetEndPoints ends'));
assert.ok(PRELUDE.includes('Set a = geom.StartPoint')&&PRELUDE.includes('a.GetCoordinates xy'));
assert.ok(body.includes('ReadSketchEnds lines(i), ends')&&body.includes('If gFatal <> "" Then Exit Sub'));
assert.ok(!body.includes('closure from explicit coordinates'),'unsupported readback cannot masquerade as native closure');
assert.ok(body.includes('AddMonoEltCst(5, refLine)'));
assert.ok(body.includes('sk.Constraints.AddBiEltCst(2, refLine, refOther)'));
assert.ok(body.includes('sketchEndpointsVerified_')&&body.includes('sketchConstraints_'));
console.log('PASS: setter regression protected; documented endpoint fallback, fail-closed native checks, coincidence and count evidence. Offline only.');
