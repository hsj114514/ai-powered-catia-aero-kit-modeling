// SPDX-License-Identifier: GPL-3.0-only
/**
 * Unit tests for the STEP assembly reader, its matrix helpers and its component envelopes.
 *
 * The synthetic fixture is deliberately hostile to the record splitter: it carries a semicolon inside
 * a string literal (as a real FILE_DESCRIPTION does) and an escaped quote pair positioned so that it
 * straddles the reader's 4 MiB chunk boundary. That second case is the exact shape of a bug that
 * merged 79 MB of a real export into one record.
 *
 * It is also hostile to the envelope walk: the solid's edge is a LINE whose definition point sits
 * 500 m away, which is how a real export carries construction geometry, and the shape representation
 * lists a circle so the radius inflation can be checked.
 *
 * Run from the package directory:  node test/assembly.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeStepString,
  frameToMatrix,
  invertRigid,
  multiply4,
  readStepAssembly,
  transformBox,
} from '../lib/assembly.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = path.join(here, 'tmp');
mkdirSync(tmp, { recursive: true });
const lines = [];
let failures = 0;
function check(label, condition, detail = '') {
  if (condition) lines.push(`ok   ${label}`);
  else {
    failures += 1;
    lines.push(`FAIL ${label}${detail ? ` :: ${detail}` : ''}`);
  }
}
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

// ---- string decoding ----
check('decodes CATIA UTF-16 escapes', decodeStepString('\\X2\\8F6667B6\\X0\\') === '车架', decodeStepString('\\X2\\8F6667B6\\X0\\'));
check('decodes doubled quote', decodeStepString("O''Brien") === "O'Brien", decodeStepString("O''Brien"));

// ---- matrix helpers ----
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translate = [1, 0, 0, 100, 0, 1, 0, 200, 0, 0, 1, 300, 0, 0, 0, 1];
check('multiply by identity is a no-op', JSON.stringify(multiply4(translate, identity)) === JSON.stringify(translate));
const round = multiply4(translate, invertRigid(translate));
check('invertRigid round-trips to identity', round.every((v, i) => near(v, identity[i])), round.map((v) => v.toFixed(3)).join(','));
const frame = frameToMatrix([10, 20, 30], [0, 0, 1], [1, 0, 0]);
check('frameToMatrix places the origin', near(frame[3], 10) && near(frame[7], 20) && near(frame[11], 30), frame.join(','));
// Rows (0,-1,0|50) (1,0,0|0) (0,0,1|0) map (x,y,z) to (50-y, x, z), so a box spanning x 0..10 and
// y 0..20 must come back as x 30..50, y 0..10.
const boxed = transformBox([0, -1, 0, 50, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], { min: [0, 0, 0], max: [10, 20, 0] });
check(
  'transformBox encloses a rotated box',
  near(boxed.min[0], 30) && near(boxed.max[0], 50) && near(boxed.min[1], 0) && near(boxed.max[1], 10),
  JSON.stringify(boxed),
);

// ---- synthetic assembly fixture ----
const CHUNK = 1 << 22;
const fixture = path.join(tmp, 'assembly-fixture.stp');
const header = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION(('CATIA V5 STEP Exchange','CAx-IF Rec.Pracs.--- unit test ---3.4---2017-06-13'),'2;1');",
  "FILE_NAME('fixture.stp','2026-01-01T00:00:00',('nobody'),('none'),'CATIA Version 5-6','CATIA V5 STEP AP203 v3','none');",
  "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN'));",
  'ENDSEC;',
  'DATA;',
].join('\r\n') + '\r\n';

const body = [
  "#1=PRODUCT('root','','',(#900));",
  "#2=PRODUCT('leaf','','',(#900));",
  "#3=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('root','',#1,.NOT_KNOWN.);",
  "#4=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('leaf','',#2,.NOT_KNOWN.);",
  "#5=PRODUCT_DEFINITION('root','',#3,#901);",
  "#6=PRODUCT_DEFINITION('leaf','',#4,#901);",
  "#7=PRODUCT_DEFINITION_SHAPE('','',#5);",
  "#8=PRODUCT_DEFINITION_SHAPE('','',#6);",
  "#9=SHAPE_REPRESENTATION('root shape',(#30),#901);",
  // The leaf's shape definition names its placement representation, and the solid is joined to that
  // by a plain SHAPE_REPRESENTATION_RELATIONSHIP 鈥?the structure a real CATIA export uses.
  "#10=SHAPE_REPRESENTATION('leaf shape',(#31),#901);",
  '#11=SHAPE_DEFINITION_REPRESENTATION(#7,#9);',
  '#12=SHAPE_DEFINITION_REPRESENTATION(#8,#10);',
  "#13=NEXT_ASSEMBLY_USAGE_OCCURRENCE('leaf.1','leaf.1','',#5,#6,'leaf.1');",
  "#14=PRODUCT_DEFINITION_SHAPE('','',#13);",
  "#15=ITEM_DEFINED_TRANSFORMATION(' ',' ',#20,#21);",
  "#16=(REPRESENTATION_RELATIONSHIP(' ',' ',#10,#9)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#15)SHAPE_REPRESENTATION_RELATIONSHIP());",
  '#17=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#16,#14);',
  "#20=AXIS2_PLACEMENT_3D(' ',#22,#24,#26);",
  "#21=AXIS2_PLACEMENT_3D(' ',#23,#25,#27);",
  "#22=CARTESIAN_POINT(' ',(0.,0.,0.));",
  "#23=CARTESIAN_POINT(' ',(100.,200.,300.));",
  "#24=DIRECTION(' ',(0.,0.,1.));",
  "#25=DIRECTION(' ',(0.,0.,1.));",
  "#26=DIRECTION(' ',(1.,0.,0.));",
  "#27=DIRECTION(' ',(1.,0.,0.));",
  "#30=AXIS2_PLACEMENT_3D(' ',#22,#24,#26);",
  "#31=AXIS2_PLACEMENT_3D(' ',#22,#24,#26);",
  // geometry: a closed shell whose vertices span 0..(10,20,30), plus a 脴10 circle 100 mm out.
  "#200=ADVANCED_BREP_SHAPE_REPRESENTATION('NONE',(#210,#260),#901);",
  "#250=SHAPE_REPRESENTATION_RELATIONSHIP(' ',' ',#10,#200);",
  "#210=MANIFOLD_SOLID_BREP('solid',#220);",
  "#220=CLOSED_SHELL('',(#230));",
  "#230=ADVANCED_FACE('',(#240),#255);",
  "#255=PLANE(' ',#261);",
  "#240=FACE_OUTER_BOUND('',#245,.T.);",
  "#245=EDGE_LOOP('',(#246));",
  "#246=ORIENTED_EDGE('',*,*,#247,.T.);",
  "#247=EDGE_CURVE('',#248,#249,#251,.T.);",
  "#248=VERTEX_POINT('',#300);",
  "#249=VERTEX_POINT('',#301);",
  "#251=LINE(' ',#302,#304);",
  "#300=CARTESIAN_POINT(' ',(0.,0.,0.));",
  "#301=CARTESIAN_POINT(' ',(10.,20.,30.));",
  "#302=CARTESIAN_POINT(' ',(500000.,0.,0.));",
  "#304=VECTOR('',#305,1.);",
  "#305=DIRECTION(' ',(1.,0.,0.));",
  "#260=CIRCLE(' ',#261,5.);",
  "#261=AXIS2_PLACEMENT_3D(' ',#262,#24,#26);",
  "#262=CARTESIAN_POINT(' ',(10.,10.,10.));",
  'ENDSEC;',
  'END-ISO-10303-21;',
].join('\r\n') + '\r\n';

// Pad so that the escaped quote pair of `O''Brien` straddles the reader's chunk boundary.
const pairPrefix = "#40=PRODUCT('O";
const fillerLine = "#900001=CARTESIAN_POINT('F',(0.,0.,0.)) ;\r\n";
const target = CHUNK - 1;
let padding = '';
{
  const need = target - (header.length + pairPrefix.length);
  const repeats = Math.max(0, Math.floor(need / fillerLine.length));
  padding = fillerLine.repeat(repeats);
  padding += ' '.repeat(Math.max(0, need - padding.length));
}
check('fixture places the quote pair across the chunk boundary', header.length + padding.length + pairPrefix.length === target, `${header.length + padding.length + pairPrefix.length} vs ${target}`);
writeFileSync(fixture, header + padding + `${pairPrefix}''Brien','','',(#900));\r\n` + body, 'utf8');

// ---- structure and placements ----
const result = await readStepAssembly(fixture, { includeBounds: false });
check('splitter recovers every entity across the chunk boundary', result.stats.entities > 40, `entities=${result.stats.entities}`);
check('root product resolved by name', result.roots.length === 1 && result.roots[0].label === 'root', JSON.stringify(result.roots));
check('one child instance found', result.instances.length === 1, `instances=${result.instances.length}`);
const child = result.instances[0];
check('instance path keeps the hierarchy', child?.path === 'root/leaf.1', child?.path);
check('instance depth is 1', child?.depth === 1, String(child?.depth));
check('placement resolves', child?.placementResolved === true, String(child?.placementResolved));
check('absolute origin is the composed placement', child?.origin?.every((v, i) => near(v, [100, 200, 300][i], 1e-6)), JSON.stringify(child?.origin));
check('every placement passes the shape cross-check', result.stats.representationMatches === 1 && result.stats.representationMismatches === 0, JSON.stringify(result.stats));
check('escaped name survives the pad', result.stats.products === 3, `products=${result.stats.products}`);
check('bounds stay off unless requested', result.stats.boundsValidation === 'not-computed', result.stats.boundsValidation);

// ---- component envelopes ----
const withBounds = await readStepAssembly(fixture, { includeBounds: true });
const instance = withBounds.instances[0];
const local = instance?.localBounds;
check('envelope walk reaches the solid through the representation relationship', withBounds.stats.boundsFromGeometry === 1, JSON.stringify(withBounds.stats));
check(
  'envelope is the vertex box of the solid',
  local && near(local.min[0], 0) && near(local.min[1], 0) && near(local.min[2], 0),
  JSON.stringify(local),
);
// The construction point of the LINE sits 500 m away and must not enter the envelope; the circle
// contributes its centre plus radius, so the box reaches 15 mm and no further.
check(
  'construction point 500 m away is excluded, circle radius is included',
  local && near(local.max[0], 15) && near(local.max[1], 20) && near(local.max[2], 30),
  JSON.stringify(local?.max),
);
check(
  'envelope is transformed into the assembly frame',
  instance?.bounds && near(instance.bounds.min[0], 100) && near(instance.bounds.min[1], 200) && near(instance.bounds.min[2], 300)
    && near(instance.bounds.max[0], 115) && near(instance.bounds.max[1], 220) && near(instance.bounds.max[2], 330),
  JSON.stringify(instance?.bounds),
);
check('a plausible envelope is not flagged suspect', instance?.boundsSuspect === undefined && withBounds.stats.boundsSuspect === 0, JSON.stringify(withBounds.stats.boundsSuspect));
check('envelope source is reported', instance?.boundsSource === 'geometry', instance?.boundsSource);
check(
  'envelope cost is reported and within budget',
  Number(withBounds.stats.envelopeMemoryMB) > 0 && Number(withBounds.stats.envelopeMemoryMB) < 64,
  String(withBounds.stats.envelopeMemoryMB),
);

rmSync(tmp, { recursive: true, force: true });
lines.push('');
lines.push(failures === 0 ? 'ALL ASSEMBLY CHECKS PASSED' : `${failures} ASSEMBLY CHECK(S) FAILED`);
writeFileSync(path.join(here, 'assembly-report.txt'), `${lines.join('\n')}\n`, 'utf8');
process.exitCode = failures === 0 ? 0 : 1;

