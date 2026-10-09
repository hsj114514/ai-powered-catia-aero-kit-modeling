// SPDX-License-Identifier: GPL-3.0-only
/** Explicit applicability and missing inputs; unverified competition rules never reject. */
import { readFileSync } from 'node:fs';
import { hardReject } from './failure-taxonomy.js';
const RULE_FILE = new URL('../rules/fsec_rules.json', import.meta.url);
const FIELDS = ['rule_id','rule_version','source','component','constraint_type','parameter','limit','unit','description','verification_status'];
const TYPES = new Set(['envelope','min_clearance','height_zone','file_safety','execution_safety','parameter_validity']);
export function validateRules(rules) {
  if (!Array.isArray(rules) || rules.length > 1024) throw new Error('rules must be a bounded array');
  const ids = new Set();
  for (const r of rules) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('rule must be an object');
    for (const k of FIELDS) if (!Object.hasOwn(r,k)) throw new Error('rule ' + r.rule_id + ' missing field ' + k);
    for (const k of ['rule_id','rule_version','source','component','parameter','unit','description']) if (typeof r[k]!=='string'||!r[k].trim()) throw new Error('rule '+k+' must be a nonempty string');
    if (ids.has(r.rule_id)) throw new Error('duplicate rule_id '+r.rule_id); ids.add(r.rule_id);
    if (!['HARD_CONSTRAINT','UNVERIFIED'].includes(r.verification_status)) throw new Error('unknown verification_status');
    if (!TYPES.has(r.constraint_type)) throw new Error('unsupported rule constraint_type '+r.constraint_type);
    if (['min_clearance','height_zone'].includes(r.constraint_type) && (typeof r.limit!=='number'||!Number.isFinite(r.limit)||r.limit<0)) throw new Error('rule limit must be finite and nonnegative');
    if (r.constraint_type==='parameter_validity' && !['finite','positive','nonnegative','boolean'].includes(r.validation)) throw new Error('parameter rule needs an explicit validation mode');
    if (r.constraint_type==='envelope' && r.verification_status==='HARD_CONSTRAINT') throw new Error('scalar envelope enforcement is not implemented; use the geometric engine with vehicle datums');
    if (r.verification_status==='HARD_CONSTRAINT' && (!['internal','competition'].includes(r.source_type)||r.rule_version==='unconfirmed'||r.source_type==='competition'&&!r.confirmation)) throw new Error('hard rule requires source_type, confirmed version and competition confirmation');
    if (r.applies_to!==undefined && (!Array.isArray(r.applies_to)||r.applies_to.some(x=>typeof x!=='string'))) throw new Error('applies_to must list element kinds');
  }
  return rules;
}
export function loadRules(file=RULE_FILE) { return validateRules(JSON.parse(readFileSync(file,'utf8')).rules); }
export function rulesByStatus(rules=loadRules()) {validateRules(rules);return {hard:rules.filter(r=>r.verification_status==='HARD_CONSTRAINT'),unverified:rules.filter(r=>r.verification_status==='UNVERIFIED')};}
export function evaluateRules(candidate={},rules=loadRules()) {
  validateRules(rules);
  if (!candidate||typeof candidate!=='object'||Array.isArray(candidate)) throw new Error('candidate must be an object');
  const rejects=[],warnings=[],enforced=[],checked=[],missing=[],notApplicable=[];
  for (const r of rules) {
    if ((r.component!=='all'&&r.component!=='all_aero'&&candidate.component&&r.component!==candidate.component)||(r.applies_to&&candidate.kind&&!r.applies_to.includes(candidate.kind))) {notApplicable.push(r.rule_id);continue;}
    if (!Object.hasOwn(candidate,r.parameter)) {missing.push({rule_id:r.rule_id,parameter:r.parameter,verification_status:r.verification_status});continue;}
    const value=candidate[r.parameter];
    if (r.constraint_type==='envelope') {warnings.push({rule_id:r.rule_id,status:'UNVERIFIED_NOT_ENFORCED',note:'needs geometric engine and vehicle datums'});continue;}
    const bool=['file_safety','execution_safety'].includes(r.constraint_type)||r.validation==='boolean';
    const valid=bool?typeof value==='boolean':typeof value==='number'&&Number.isFinite(value);
    let violated=!valid;
    if (valid) {
      if (r.constraint_type==='min_clearance') violated=value<r.limit;
      if (r.constraint_type==='height_zone') violated=value>r.limit;
      if (['file_safety','execution_safety'].includes(r.constraint_type)) violated=value;
      if (r.constraint_type==='parameter_validity') violated=r.validation==='positive'?value<=0:r.validation==='nonnegative'?value<0:false;
    }
    checked.push(r.rule_id);
    if (r.verification_status==='UNVERIFIED') warnings.push({rule_id:r.rule_id,parameter:r.parameter,value:Number.isFinite(value)||typeof value==='boolean'?value:null,limit:r.limit,violated,status:'UNVERIFIED_NOT_ENFORCED'});
    else {
      enforced.push(r.rule_id);
      if (violated) {const code=r.constraint_type==='file_safety'?'H08':r.constraint_type==='execution_safety'?'H09':!valid||r.constraint_type==='parameter_validity'?'H05':'H01';rejects.push({...hardReject(code,r.rule_id+' violated by '+r.parameter+'='+String(value)),rule_id:r.rule_id});}
    }
  }
  return {status:rejects.length?'BLOCKED':missing.length||warnings.length?'PARTIAL_SUCCESS':'SUCCESS',rejects,warnings,enforced,checked,missing,notApplicable,fullCompetitionCompliance:false};
}
export function candidateForElement(e) {
  const p=e.params??{},out={kind:e.kind};
  const aliases={chord:'chord',chordRoot:'chord',chordTip:'tip_chord',span:'span',aoaRoot:'aoa',aoaDeg:'aoa',twist:'twist',twistDeg:'twist',height:'height',thickness:'thickness',thicknessScale:'thickness_scale',gap:'gap',deflectionDeg:'deflection'};
  for (const [field,key] of Object.entries(aliases)) if (Object.hasOwn(p,field)) out[key]=p[field];
  return out;
}
