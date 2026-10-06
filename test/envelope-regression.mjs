// SPDX-License-Identifier: GPL-3.0-only
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStepAssembly } from '../lib/assembly.js';
import { buildToolDefinitions } from '../lib/tools.js';
import { CatiaBridge, normalizeSettings } from '../lib/bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = mkdtempSync(path.join(here, 'envelope-regression-'));
const file = path.join(temp, 'curve.stp');
const assembly = (geometry) => `ISO-10303-21;HEADER;ENDSEC;DATA;
#1=PRODUCT('root','','',(#900));#2=PRODUCT('leaf','','',(#900));
#3=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('root','',#1,.NOT_KNOWN.);#4=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('leaf','',#2,.NOT_KNOWN.);
#5=PRODUCT_DEFINITION('root','',#3,#901);#6=PRODUCT_DEFINITION('leaf','',#4,#901);
#7=PRODUCT_DEFINITION_SHAPE('','',#5);#8=PRODUCT_DEFINITION_SHAPE('','',#6);
#9=SHAPE_REPRESENTATION('root',(#20),#901);#10=SHAPE_REPRESENTATION('leaf',(#251,#248,#249),#901);
#11=SHAPE_DEFINITION_REPRESENTATION(#7,#9);#12=SHAPE_DEFINITION_REPRESENTATION(#8,#10);
#13=NEXT_ASSEMBLY_USAGE_OCCURRENCE('leaf.1','leaf.1','',#5,#6,'leaf.1');#14=PRODUCT_DEFINITION_SHAPE('','',#13);
#15=ITEM_DEFINED_TRANSFORMATION('','',#20,#20);
#16=(REPRESENTATION_RELATIONSHIP('','',#10,#9)REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#15)SHAPE_REPRESENTATION_RELATIONSHIP());
#17=CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#16,#14);
#20=AXIS2_PLACEMENT_3D('',#22,#24,#26);#22=CARTESIAN_POINT('',(0.,0.,0.));#24=DIRECTION('',(0.,0.,1.));#26=DIRECTION('',(1.,0.,0.));
#248=VERTEX_POINT('',#300);#249=VERTEX_POINT('',#301);
#300=CARTESIAN_POINT('',(0.,0.,0.));#301=CARTESIAN_POINT('',(100.,0.,0.));
${geometry}
ENDSEC;END-ISO-10303-21;`;
const curve = `#251=B_SPLINE_CURVE_WITH_KNOTS('',2,(#300,#306,#301),.UNSPECIFIED.,.F.,.F.,(3,3),(0.,1.),.UNSPECIFIED.);
#306=CARTESIAN_POINT('',(50.,1200.,0.));`;
const contains = (box, p) => p.every((v, axis) => v >= box.min[axis] && v <= box.max[axis]);
async function parse(geometry) {
  writeFileSync(file, assembly(geometry));
  return readStepAssembly(file, { includeBounds: true });
}
try {
  let result = await parse(curve);
  // Independent mathematical witness: the quadratic Bezier midpoint is (50,600,0).
  assert.ok(contains(result.instances[0].bounds, [50, 600, 0]), 'the envelope must contain the actual curve midpoint');
  assert.equal(result.instances[0].bounds.max[1], 1200, 'the complete nonrational control hull is retained');
  assert.equal(result.instances[0].boundsUsableForCompliance, false);
  assert.equal(result.instances[0].boundsIncomplete, false);

  result = await parse(`#251=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#300, #301), (#306, #307)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);
#306=CARTESIAN_POINT('',(0.,1200.,0.));#307=CARTESIAN_POINT('',(100.,1200.,0.));`);
  assert.ok(contains(result.instances[0].bounds, [50, 600, 0]), 'every row of a surface control net is included');

  const count = 4200;
  const refs = Array.from({ length: count }, (_, i) => `#${1000 + i}`);
  const points = refs.map((ref, i) => `${ref}=CARTESIAN_POINT('',(${i}.,${i === count - 1 ? 1200 : 0}.,0.));`).join('\n');
  result = await parse(`#251=B_SPLINE_CURVE_WITH_KNOTS('',1,(${refs.join(',')}),.UNSPECIFIED.,.F.,.F.,(2,${Array(count - 2).fill(1).join(',')},2),(${Array.from({ length: count }, (_, i) => i).join(',')}),.UNSPECIFIED.);\n${points}`);
  assert.ok(contains(result.instances[0].bounds, [count - 1, 1200, 0]), 'control points beyond 4096 are not silently dropped');

  result = await parse(`#251=CIRCLE('',#20,2500.);`);
  assert.equal(result.instances[0].boundsStatus, 'incomplete');
  assert.ok(result.instances[0].boundsWarnings.includes('radius-excluded-by-size-limit'));
  assert.equal(result.instances[0].subtreeBoundsIncomplete, true);

  result = await parse(`#251=(BOUNDED_CURVE()B_SPLINE_CURVE(2,(#300,#306,#301),.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS((3,3),(0.,1.),.UNSPECIFIED.)CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE((1.,1.,1.))REPRESENTATION_ITEM(''));
#306=CARTESIAN_POINT('',(50.,1200.,0.));`);
  assert.equal(result.instances[0].boundsIncomplete, true, 'unsupported complex geometry is not presented as complete');
  await assert.rejects(readStepAssembly(file, { includeBounds: true, maxEnvelopeBytes: NaN }), /finite/);

  const settings = normalizeSettings({ projectRoot: path.join(temp, 'projects') }, temp);
  const bridge = new CatiaBridge(settings);
  const tool = buildToolDefinitions(bridge, settings).find((entry) => entry.name === 'step_assembly_components');
  await parse(curve);
  const output = await tool.execute({ project: 'regression', file, includeBounds: true, exportCsv: true });
  assert.ok(contains(output.components[0].bounds, [50, 600, 0]), 'the public Agent tool exposes the requested envelope');
  assert.equal(output.metrics.boundsUsableForCompliance, false);
  const csv = readFileSync(path.join(bridge.projectPaths('regression').exports, output.file), 'utf8');
  assert.ok(csv.includes('boundsStatus,boundsWarnings,boundsUsableForCompliance'));
  assert.ok(csv.includes('1200.0000'));
  const without = await tool.execute({ project: 'regression', file, exportCsv: false });
  assert.equal(without.components[0].bounds, undefined, 'envelope calculation remains opt-in');
  await parse(`#251=CIRCLE('',#20,2500.);`);
  const partial = await tool.execute({ project: 'regression', file, includeBounds: true, exportCsv: false });
  assert.equal(partial.status, 'PARTIAL_SUCCESS');
  assert.equal(partial.components[0].boundsStatus, 'incomplete');
  console.log('PASS: curve containment, full surface net, >4096 controls, incomplete geometry, budgets, Agent tool and CSV.');
} finally {
  if (path.dirname(temp) !== here) throw new Error('Temporary directory escaped the test directory');
  rmSync(temp, { recursive: true, force: true });
}
