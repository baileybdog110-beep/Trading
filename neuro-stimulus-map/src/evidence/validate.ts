import type { EvidenceDB } from './types';

const GRADES = new Set(['strong', 'moderate', 'limited', 'contested']);
const APPLICABILITY = new Set(['direct', 'partial', 'extrapolation']);
const CONFIDENCE = new Set(['low', 'moderate', 'high']);
const DOI_RE = /^10\.\d{4,9}\/\S+$/;

/**
 * Structural and referential checks for the evidence database.
 * Returns a list of human-readable problems; an empty list means the database is consistent.
 * The key guarantee: no association can be displayed without at least one supporting,
 * existing, verification-annotated source record.
 */
export function validateEvidenceDB(db: EvidenceDB, atlasMeshIds?: Set<string>): string[] {
  const errors: string[] = [];
  const dup = (kind: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) errors.push(`duplicate ${kind} id: ${id}`);
      seen.add(id);
    }
    return seen;
  };
  const sources = dup('source', db.sources.map((s) => s.id));
  const regions = dup('region', db.regions.map((r) => r.id));
  const networks = dup('network', db.networks.map((n) => n.id));
  const processes = dup('process', db.processes.map((p) => p.id));
  const features = dup('feature', db.features.map((f) => f.id));
  dup('association', db.associations.map((a) => a.id));
  dup('rule', db.rules.map((r) => r.id));
  dup('unsupported', db.unsupported.map((u) => u.id));

  for (const s of db.sources) {
    for (const key of ['shortCite', 'authors', 'title', 'venue', 'url', 'design', 'method', 'population', 'stimuli', 'comparison'] as const) {
      if (!s[key] || String(s[key]).trim() === '') errors.push(`source ${s.id}: missing ${key}`);
    }
    if (!Number.isInteger(s.year) || s.year < 1900 || s.year > 2100) errors.push(`source ${s.id}: bad year`);
    if (s.doi && !DOI_RE.test(s.doi)) errors.push(`source ${s.id}: malformed DOI ${s.doi}`);
    if (s.pmid && !/^\d{5,9}$/.test(s.pmid)) errors.push(`source ${s.id}: malformed PMID ${s.pmid}`);
    if (!/^https:\/\//.test(s.url)) errors.push(`source ${s.id}: url must be https`);
    if (!s.keyFindings?.length) errors.push(`source ${s.id}: no key findings`);
    if (!s.limitations?.length) errors.push(`source ${s.id}: no limitations`);
    if (s.n !== null && typeof s.n !== 'string') errors.push(`source ${s.id}: n must be string or null`);
    const v = s.verification;
    if (!v || !['search-index', 'abstract', 'full-text'].includes(v.level)) errors.push(`source ${s.id}: missing verification level`);
    else if (!v.via?.length || !v.checkedOn) errors.push(`source ${s.id}: verification must list where and when it was checked`);
  }

  for (const r of db.regions) {
    if (!Object.keys(r.meshes).length) errors.push(`region ${r.id}: no meshes`);
    for (const mesh of Object.values(r.meshes)) {
      if (atlasMeshIds && mesh && !atlasMeshIds.has(mesh)) errors.push(`region ${r.id}: mesh ${mesh} not in atlas`);
    }
  }
  for (const n of db.networks) {
    for (const mesh of [n.meshes.L, n.meshes.R]) {
      if (atlasMeshIds && !atlasMeshIds.has(mesh)) errors.push(`network ${n.id}: mesh ${mesh} not in atlas`);
    }
  }

  const processesWithAssociations = new Set<string>();
  for (const a of db.associations) {
    if (!processes.has(a.process)) errors.push(`association ${a.id}: unknown process ${a.process}`);
    processesWithAssociations.add(a.process);
    if (!GRADES.has(a.grade)) errors.push(`association ${a.id}: bad grade ${a.grade}`);
    if (!a.claim?.trim()) errors.push(`association ${a.id}: empty claim`);
    for (const k of ['consistency', 'quality', 'directness', 'replication'] as const) {
      if (!a.gradeRationale?.[k]?.trim()) errors.push(`association ${a.id}: missing grade rationale '${k}'`);
    }
    if (!a.targets.length) errors.push(`association ${a.id}: no targets`);
    for (const t of a.targets) {
      if (t.kind === 'region') {
        const region = db.regions.find((r) => r.id === t.id);
        if (!regions.has(t.id) || !region) {
          errors.push(`association ${a.id}: unknown region ${t.id}`);
          continue;
        }
        const needs = t.hemi === 'both' ? ['L', 'R'] : t.hemi === 'bilateral' ? ['bilateral'] : [t.hemi];
        for (const h of needs) {
          if (!(region.meshes as Record<string, string>)[h]) errors.push(`association ${a.id}: region ${t.id} has no ${h} mesh`);
        }
      } else if (!networks.has(t.id)) {
        errors.push(`association ${a.id}: unknown network ${t.id}`);
      }
      if (t.precision === 'approximate' && !t.functionalLabel && !t.note) {
        errors.push(`association ${a.id}: approximate target ${t.id} must explain what it approximates`);
      }
    }
    const supporting = a.citations.filter((c) => c.role === 'supports');
    if (!supporting.length) errors.push(`association ${a.id}: needs at least one supporting citation`);
    if (a.grade === 'contested' && !a.citations.some((c) => c.role === 'conflicts')) {
      errors.push(`association ${a.id}: contested grade requires a conflicting citation`);
    }
    for (const c of a.citations) {
      if (!sources.has(c.source)) errors.push(`association ${a.id}: unknown source ${c.source}`);
      if (!c.finding?.trim()) errors.push(`association ${a.id}: citation ${c.source} has no finding text`);
    }
    if (!a.limitations?.length) errors.push(`association ${a.id}: list at least one limitation`);
  }

  const unsupportedProcesses = new Set(db.unsupported.flatMap((u) => u.appliesTo.processes ?? []));
  for (const r of db.rules) {
    if (!features.has(r.feature)) errors.push(`rule ${r.id}: unknown feature ${r.feature}`);
    if (!processes.has(r.process)) errors.push(`rule ${r.id}: unknown process ${r.process}`);
    if (!APPLICABILITY.has(r.applicability)) errors.push(`rule ${r.id}: bad applicability`);
    if (!CONFIDENCE.has(r.minConfidence)) errors.push(`rule ${r.id}: bad minConfidence`);
    if (!r.rationale?.trim()) errors.push(`rule ${r.id}: missing rationale`);
    if (!processesWithAssociations.has(r.process) && !unsupportedProcesses.has(r.process)) {
      errors.push(`rule ${r.id}: process ${r.process} has neither associations nor an explicit unsupported record`);
    }
  }
  for (const u of db.unsupported) {
    for (const s of u.sources) if (!sources.has(s)) errors.push(`unsupported ${u.id}: unknown source ${s}`);
    for (const f of u.appliesTo.features ?? []) if (!features.has(f)) errors.push(`unsupported ${u.id}: unknown feature ${f}`);
    for (const p of u.appliesTo.processes ?? []) if (!processes.has(p)) errors.push(`unsupported ${u.id}: unknown process ${p}`);
  }
  return errors;
}
