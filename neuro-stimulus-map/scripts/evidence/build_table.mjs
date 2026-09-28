#!/usr/bin/env node
// Generate docs/EVIDENCE_TABLE.md from data/evidence/*.json so reviewers can read the
// curated evidence without running the app. Run: npm run evidence:table
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const load = (n) => JSON.parse(readFileSync(new URL(`../../data/evidence/${n}.json`, import.meta.url), 'utf8'));
const sources = load('sources');
const associations = load('associations');
const processes = load('processes');
const regions = load('regions');
const networks = load('networks');
const rules = load('rules');
const features = load('features');
const unsupported = load('unsupported');
const meta = load('meta');
const src = new Map(sources.map((s) => [s.id, s]));
const proc = new Map(processes.map((p) => [p.id, p]));
const targetName = (t) => (t.kind === 'region' ? regions.find((r) => r.id === t.id)?.name : networks.find((n) => n.id === t.id)?.name) ?? t.id;
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const link = (s) => (s.doi ? `[doi:${s.doi}](https://doi.org/${s.doi})` : s.pmid ? `[PMID ${s.pmid}](https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/)` : `[record](${s.url})`);

let md = `# Curated evidence table\n\nGenerated from \`data/evidence/*.json\` (version ${meta.version}, curated ${meta.curatedOn}). Do not edit by hand; run \`npm run evidence:table\`.\n\n`;
md += `> **Verification status.** ${meta.verificationStatement}\n\n`;
md += `## Grading rubric\n\n| Category | Meaning |\n|---|---|\n`;
for (const [k, v] of Object.entries(meta.gradingRubric)) md += `| ${k} | ${esc(v)} |\n`;
md += `\n| Applicability | Meaning |\n|---|---|\n`;
for (const [k, v] of Object.entries(meta.applicabilityRubric)) md += `| ${k} | ${esc(v)} |\n`;

md += `\n## Associations (process → region / network)\n\n| Process | Targets | Grade | Claim | Grade rationale | Sources (role) |\n|---|---|---|---|---|---|\n`;
for (const a of associations) {
  const targets = a.targets.map((t) => `${targetName(t)} (${t.hemi}${t.precision === 'approximate' ? ', ≈ ' + (t.functionalLabel ?? 'approximate') : ''})`).join('; ');
  const rationale = `Consistency: ${a.gradeRationale.consistency} Quality: ${a.gradeRationale.quality} Directness: ${a.gradeRationale.directness} Replication: ${a.gradeRationale.replication}`;
  const cites = a.citations.map((c) => `${src.get(c.source)?.shortCite} (${c.role})`).join('; ');
  md += `| ${esc(proc.get(a.process)?.name)} | ${esc(targets)} | ${a.grade} | ${esc(a.claim)} | ${esc(rationale)} | ${esc(cites)} |\n`;
}

md += `\n## Sources\n\n| Source | Stimulus / task | Design & measurement | Population / n | Comparison | Findings used | Limitations | Naturalistic | Verification |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const s of sources) {
  md += `| ${esc(`${s.authors} (${s.year}). ${s.title}. *${s.venue}*${s.details ? ', ' + s.details : ''}.`)} ${link(s)} | ${esc(s.stimuli)} | ${esc(`${s.design}: ${s.method}`)} | ${esc(`${s.population} n = ${s.n ?? 'not verified'}`)} | ${esc(s.comparison)} | ${esc(s.keyFindings.join(' '))} | ${esc(s.limitations.join(' '))} | ${s.naturalistic ? 'yes' : 'no'} | ${esc(`${s.verification.level} (${s.verification.checkedOn})${s.verification.notes ? ': ' + s.verification.notes : ''}`)} |\n`;
}

md += `\n## Feature → process rules\n\n| Feature | Process | Applicability | Min. detection | Rationale | Assumes |\n|---|---|---|---|---|---|\n`;
for (const r of rules) {
  md += `| ${esc(features.find((f) => f.id === r.feature)?.name)} | ${esc(proc.get(r.process)?.name)} | ${r.applicability} | ${r.minConfidence}${r.requiresConfirmation ? ' + confirmation' : ''} | ${esc(r.rationale)} | ${esc(r.conditions.join(' '))} |\n`;
}

md += `\n## Deliberately not mapped (insufficient evidence)\n\n| Topic | Reason |\n|---|---|\n`;
for (const u of unsupported) md += `| ${esc(u.topic)} | ${esc(u.reason)} |\n`;

mkdirSync(new URL('../../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL('../../docs/EVIDENCE_TABLE.md', import.meta.url), md);
console.log(`wrote docs/EVIDENCE_TABLE.md (${associations.length} associations, ${sources.length} sources)`);
