import { featureById, meshIndex, networkById, processById, regionById } from '../evidence/db';
import type { Association } from '../evidence/types';
import type { MeshResult, TargetHit } from '../pipeline/mapping';
import { ApplicabilityBadge, ConfidenceBadge, GradeBadge, SourceCard } from './bits';
import { ReasonList, reasonsFor } from './HighlightedPanel';
import { meshLabel } from './ReasoningPanel';

export function RegionPanel({
  meshId,
  results,
  onSelect,
  onBack,
  onShowBrain,
}: {
  meshId: string;
  results: Map<string, MeshResult>;
  onSelect: (meshId: string) => void;
  onBack: () => void;
  onShowBrain: () => void;
}) {
  const result = results.get(meshId);
  const info = meshIndex.get(meshId);
  const region = info?.kind === 'region' ? regionById.get(info.id) : undefined;
  const network = info?.kind === 'network' ? networkById.get(info.id) : undefined;
  // the same region in the other hemisphere, when the atlas has one
  const partner = info && info.hemi !== 'bilateral' ? (region?.meshes ?? network?.meshes)?.[info.hemi === 'L' ? 'R' : 'L'] : undefined;
  const byAssoc = new Map<string, { a: Association; hits: TargetHit[] }>();
  for (const h of result?.hits ?? []) {
    const e = byAssoc.get(h.association.id) ?? { a: h.association, hits: [] };
    e.hits.push(h);
    byAssoc.set(h.association.id, e);
  }

  return (
    <div className="region-panel">
      <div className="region-nav">
        <button type="button" className="btn small ghost" onClick={onBack}>
          ‹ All highlighted areas
        </button>
        <button type="button" className="btn small ghost only-narrow" onClick={onShowBrain}>
          Show on the brain
        </button>
      </div>
      <div className="region-head">
        <h3>{meshLabel(meshId)}</h3>
        {partner && info && (
          <div className="seg-control small" role="radiogroup" aria-label="Hemisphere">
            {(['L', 'R'] as const).map((h) => {
              const id = h === info.hemi ? meshId : partner;
              return (
                <button key={h} type="button" role="radio" aria-checked={h === info.hemi} className={h === info.hemi ? 'is-on' : ''} onClick={() => onSelect(id)}>
                  {h === 'L' ? 'Left' : 'Right'}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <p className="region-summary">{region?.summary ?? network?.summary}</p>

      {result ? (
        <div className="hl-why">
          <span className="hl-why-label">Why it's coloured in this segment</span>
          <ReasonList reasons={reasonsFor([result])} />
        </div>
      ) : (
        <div className="insufficient">
          <GradeBadge grade="insufficient" />
          <p>
            No verified evidence record links this segment's detected features to this {network ? 'network' : 'region'}. Gray does not mean the region is inactive - every region is active all
            the time; it means this evidence base has nothing to say about it for this content.
          </p>
        </div>
      )}

      <details className="anatomy">
        <summary>Where it is and what else it does</summary>
        <p className="small muted">{region ? `${region.lobe} · ${region.kind} · atlas: CerebrA` : 'Resting-state network (Yeo 7-network layout, Schaefer 2018)'}</p>
        <p className="small">{region?.orientation ?? network?.orientation}</p>
        {region && <p className="small">{region.multifunction}</p>}
      </details>

      {byAssoc.size > 0 && <h4 className="region-evidence-title">The research behind the colour</h4>}
      {[...byAssoc.values()].map(({ a, hits }) => {
        const target = hits[0].target;
        const features = [...new Map(hits.map((h) => [h.feature.id, h])).values()];
        const sources = a.citations.filter((c) => c.role === 'supports').length;
        return (
          <article key={a.id} className="assoc-card">
            <header>
              <GradeBadge grade={a.grade} />
              <strong>{processById.get(a.process)?.name}</strong>
            </header>
            <p>{a.claim}</p>
            {target.precision === 'approximate' && (
              <p className="small callout">
                Anatomical precision: the finding concerns {target.functionalLabel ?? 'a functional area'}; the highlighted atlas region is broader. {target.note ?? ''}
              </p>
            )}
            {target.precision === 'atlas' && target.note && <p className="small muted">{target.note}</p>}
            <section>
              <h5>Detected in the media</h5>
              {features.map((h) => (
                <div key={h.feature.id} className="row wrap">
                  <strong className="small">{featureById.get(h.feature.id)?.name}</strong>
                  <ConfidenceBadge f={h.feature} />
                  <span className="small muted">{h.feature.measurement}</span>
                </div>
              ))}
            </section>
            <details>
              <summary>How directly the research applies</summary>
              <p className="small">{processById.get(a.process)?.description}</p>
              {features.map((h) => (
                <div key={h.rule.id}>
                  <div className="row">
                    <ApplicabilityBadge a={h.applicability} />
                    {h.conditional && <span className="badge cond">Depends on the listener</span>}
                  </div>
                  <p className="small">{h.rule.rationale}</p>
                  {h.rule.conditions.length > 0 && <p className="small muted">Assumes: {h.rule.conditions.join(' ')}</p>}
                </div>
              ))}
            </details>
            <details>
              <summary>How the evidence was graded</summary>
              <dl className="kv small">
                <dt>Consistency</dt>
                <dd>{a.gradeRationale.consistency}</dd>
                <dt>Study quality</dt>
                <dd>{a.gradeRationale.quality}</dd>
                <dt>Directness</dt>
                <dd>{a.gradeRationale.directness}</dd>
                <dt>Replication</dt>
                <dd>{a.gradeRationale.replication}</dd>
              </dl>
            </details>
            <details>
              <summary>
                Sources ({a.citations.length}, {sources} supporting)
              </summary>
              {a.citations.map((c, i) => (
                <SourceCard key={`${c.source}-${i}`} id={c.source} role={c.role} finding={c.finding} />
              ))}
            </details>
            <details>
              <summary>Limitations</summary>
              <ul className="small">
                {a.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                <li>Strong evidence for a general association does not mean strong evidence that this particular clip evokes the process.</li>
              </ul>
            </details>
          </article>
        );
      })}
    </div>
  );
}
