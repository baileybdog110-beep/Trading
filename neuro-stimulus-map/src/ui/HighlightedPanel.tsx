import { useState } from 'react';
import { featureById, networkById, processById, regionById } from '../evidence/db';
import type { Applicability, Association, EvidenceGrade } from '../evidence/types';
import { GRADE_RANK, type MeshResult } from '../pipeline/mapping';
import type { Modalities } from '../pipeline/types';
import type { ViewMode } from './BrainView';
import { GRADE_LABEL, GRADE_SHORT } from './colors';

/** Plain-language explanation of a coloured area, shared by the list and the landing page. */
export function ColourMeaning() {
  return (
    <p className="meaning">
      A coloured area is one that <strong>published research links to a kind of stimulus found in this part of the media</strong>, such as speech, music or faces. Darker blue
      means stronger evidence. It is not a reading of anyone's brain: every area is active all the time, and gray areas are not switched off.
    </p>
  );
}

export interface AreaGroup {
  key: string;
  kind: 'region' | 'network';
  id: string;
  name: string;
  summary: string;
  meshes: MeshResult[];
  best: EvidenceGrade;
  /** closest applicability of any finding behind the colour */
  closest: Applicability;
  /** every finding behind the colour depends on the listener */
  onlyConditional: boolean;
}

export interface Reason {
  association: Association;
  process: string;
  features: string[];
  conditional: boolean;
  functionalLabel?: string;
}

/** Whether a mesh result is drawn in the given map layer (cortex is swapped for networks). */
export function visibleIn(mode: ViewMode, r: MeshResult): boolean {
  if (r.kind === 'network') return mode === 'networks';
  return mode === 'anatomy' || regionById.get(r.id)?.kind !== 'cortical';
}

const rank = (g: EvidenceGrade) => (g === 'contested' ? -1 : GRADE_RANK[g]);
const APPL_RANK: Record<Applicability, number> = { direct: 0, partial: 1, extrapolation: 2 };

/** How many areas the list shows before "Show all". */
export const LIST_LIMIT = 5;

/** Left and right meshes of the same region or network become one entry. */
export function groupAreas(results: Iterable<MeshResult>): AreaGroup[] {
  const groups = new Map<string, AreaGroup>();
  for (const r of results) {
    const key = `${r.kind}:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      const rec = r.kind === 'region' ? regionById.get(r.id) : networkById.get(r.id);
      g = { key, kind: r.kind, id: r.id, name: rec?.name ?? r.id, summary: rec?.summary ?? '', meshes: [], best: r.grade, closest: 'extrapolation', onlyConditional: true };
      groups.set(key, g);
    }
    g.meshes.push(r);
    if (rank(r.grade) > rank(g.best)) g.best = r.grade;
    for (const h of r.hits) {
      if (APPL_RANK[h.applicability] < APPL_RANK[g.closest]) g.closest = h.applicability;
      if (!h.conditional) g.onlyConditional = false;
    }
  }
  for (const g of groups.values()) g.meshes.sort((a, b) => a.hemi.localeCompare(b.hemi));
  // Most directly applicable first: findings that do not depend on the listener, then the closest
  // match between the research and the detected feature, then the evidence grade.
  return [...groups.values()].sort(
    (a, b) =>
      Number(a.onlyConditional) - Number(b.onlyConditional) ||
      APPL_RANK[a.closest] - APPL_RANK[b.closest] ||
      rank(b.best) - rank(a.best) ||
      a.name.localeCompare(b.name),
  );
}

/** The research associations behind a group's colour, with the detected features that led to them. */
export function reasonsFor(meshes: MeshResult[]): Reason[] {
  const out = new Map<string, Reason & { featureSet: Set<string> }>();
  for (const m of meshes) {
    for (const h of m.hits) {
      let r = out.get(h.association.id);
      if (!r) {
        r = {
          association: h.association,
          process: processById.get(h.association.process)?.name ?? h.association.process,
          features: [],
          featureSet: new Set(),
          conditional: false,
          functionalLabel: h.target.precision === 'approximate' ? h.target.functionalLabel : undefined,
        };
        out.set(h.association.id, r);
      }
      r.featureSet.add(featureById.get(h.feature.id)?.name ?? h.feature.id);
      r.conditional ||= h.conditional;
    }
  }
  return [...out.values()]
    .map(({ featureSet, ...r }) => ({ ...r, features: [...featureSet] }))
    .sort((a, b) => rank(b.association.grade) - rank(a.association.grade));
}

export function sidesText(g: AreaGroup): string {
  const hemis = new Set(g.meshes.map((m) => m.hemi));
  if (hemis.has('bilateral')) return 'Midline';
  if (hemis.has('L') && hemis.has('R')) return 'Left and right';
  return hemis.has('L') ? 'Left side' : 'Right side';
}

function GradeLine({ g }: { g: AreaGroup }) {
  const grades = new Set(g.meshes.map((m) => m.grade));
  if (grades.size === 1) return <span className="hl-grade">{GRADE_LABEL[g.best]}</span>;
  return (
    <span className="hl-grade">
      {g.meshes.map((m) => `${m.hemi === 'L' ? 'Left' : 'Right'}: ${GRADE_SHORT[m.grade]}`).join(' · ')}
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="reasons">
      {reasons.map((r) => (
        <li key={r.association.id}>
          <span className={`swatch grade-${r.association.grade}`} aria-hidden="true" />
          <span>
            <strong>{r.process}</strong>
            <span className="muted"> · from {r.features.join(', ')}</span>
            {r.conditional && <span className="badge cond">Depends on the listener</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const MODALITY_NAMES: [keyof Modalities, string][] = [
  ['audio', 'audio'],
  ['video', 'video'],
  ['faces', 'faces'],
  ['transcript', 'transcript'],
];
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One line saying what the colours can be based on, so nothing unanalysed is implied. */
export function AnalysisBasis({ m, isDemo }: { m: Modalities; isDemo: boolean }) {
  if (isDemo) return <p className="small muted hl-basis">Based on hand-authored demo features; no media was analysed.</p>;
  const used = MODALITY_NAMES.filter(([k]) => m[k].state === 'analyzed').map(([, n]) => n);
  const failed = MODALITY_NAMES.filter(([k]) => m[k].state === 'failed').map(([, n]) => n);
  const not = MODALITY_NAMES.filter(([k]) => m[k].state === 'not-analyzed' || m[k].state === 'not-present').map(([, n]) => n);
  return (
    <p className="small muted hl-basis">
      Based on: {used.length ? list(used) : 'nothing analysed'}.{not.length ? ` Not analysed or not in the file: ${list(not)}.` : ''}
      {failed.length ? ` Failed: ${list(failed)}.` : ''}
    </p>
  );
}

export function HighlightedPanel({
  results,
  mode,
  onMode,
  onSelect,
  segmentLabel,
  modalities,
  isDemo,
}: {
  modalities: Modalities;
  isDemo: boolean;
  results: Map<string, MeshResult>;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  onSelect: (meshId: string) => void;
  segmentLabel: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const all = [...results.values()];
  const groups = groupAreas(all.filter((r) => visibleIn(mode, r)));
  const elsewhere = groupAreas(all.filter((r) => !visibleIn(mode, r))).length;
  const other: ViewMode = mode === 'anatomy' ? 'networks' : 'anatomy';

  return (
    <div className="highlighted">
      <ColourMeaning />
      <h3 className="hl-count">
        {groups.length === 0
          ? `Nothing is coloured in ${segmentLabel}`
          : `${groups.length} ${mode === 'networks' ? 'network' : 'area'}${groups.length === 1 ? '' : 's'} coloured in ${segmentLabel}`}
      </h3>
      {groups.length === 0 && (
        <p className="small muted">
          No detected feature in this part of the media has a verified research association{mode === 'networks' ? ' at network level' : ''}. That does not mean the brain is doing nothing.
          The Reasoning tab shows what was detected and why nothing was mapped.
        </p>
      )}
      <AnalysisBasis m={modalities} isDemo={isDemo} />
      {groups.length > 1 && <p className="small muted hl-order">Closest matches between the research and the media come first.</p>}
      <ul className="hl-list">
        {(showAll ? groups : groups.slice(0, LIST_LIMIT)).map((g) => {
          const reasons = reasonsFor(g.meshes);
          const approx = reasons.find((r) => r.functionalLabel)?.functionalLabel;
          return (
            <li key={g.key} className={`hl-card grade-${g.best}`}>
              <div className="hl-head">
                <span className={`swatch big grade-${g.best}`} aria-hidden="true" />
                <button type="button" className="hl-title" onClick={() => onSelect(g.meshes[0].meshId)}>
                  {g.name}
                </button>
                <span className="hl-sides">{sidesText(g)}</span>
              </div>
              <GradeLine g={g} />
              <p className="hl-summary">{g.summary}</p>
              <div className="hl-why">
                <span className="hl-why-label">Why it's coloured</span>
                <ReasonList reasons={reasons} />
                {approx && <p className="small muted">≈ The research concerns the {approx}, a smaller area within this region.</p>}
              </div>
              <span className="hl-more" aria-hidden="true">
                Evidence and sources ›
              </span>
            </li>
          );
        })}
      </ul>
      {groups.length > LIST_LIMIT && (
        <button type="button" className="btn small hl-toggle" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${groups.length} areas`}
        </button>
      )}
      {elsewhere > 0 && (
        <p className="small muted hl-elsewhere">
          {elsewhere} more {elsewhere === 1 ? 'is' : 'are'} linked in the {other === 'networks' ? 'networks' : 'regions'} view.{' '}
          <button type="button" className="linklike" onClick={() => onMode(other)}>
            Switch to {other === 'networks' ? 'networks' : 'regions'}
          </button>
        </p>
      )}
    </div>
  );
}
