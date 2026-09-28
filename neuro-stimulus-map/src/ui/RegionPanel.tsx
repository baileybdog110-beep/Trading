import { featureById, meshIndex, networkById, processById, regionById } from '../evidence/db';
import type { Association } from '../evidence/types';
import type { MeshResult, TargetHit } from '../pipeline/mapping';
import { ApplicabilityBadge, ConfidenceBadge, GradeBadge, SourceCard } from './bits';
import { meshLabel } from './ReasoningPanel';

export function RegionPanel({ meshId, result, onClose }: { meshId: string; result: MeshResult | undefined; onClose: () => void }) {
  const info = meshIndex.get(meshId);
  const region = info?.kind === 'region' ? regionById.get(info.id) : undefined;
  const network = info?.kind === 'network' ? networkById.get(info.id) : undefined;
  const byAssoc = new Map<string, { a: Association; hits: TargetHit[] }>();
  for (const h of result?.hits ?? []) {
    const e = byAssoc.get(h.association.id) ?? { a: h.association, hits: [] };
    e.hits.push(h);
    byAssoc.set(h.association.id, e);
  }

  return (
    <div className="region-panel">
      <div className="region-head">
        <div>
          <h3>{meshLabel(meshId)}</h3>
          <p className="muted small">
            {region ? `${region.lobe} · ${region.kind} · atlas: CerebrA` : network ? 'Resting-state network (Yeo 7-network layout, Schaefer 2018)' : ''}
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close region details">
          ✕
        </button>
      </div>
      <p>{region?.orientation ?? network?.orientation}</p>
      {region && <p className="small muted">{region.multifunction}</p>}

      {!result && (
        <div className="insufficient">
          <GradeBadge grade="insufficient" />
          <p>
            No verified evidence record links this segment's detected features to this {network ? 'network' : 'region'}. Gray does not mean the region is inactive - every region is active all
            the time; it means this evidence base has nothing to say about it for this content.
          </p>
        </div>
      )}

      {[...byAssoc.values()].map(({ a, hits }) => {
        const target = hits[0].target;
        const features = [...new Map(hits.map((h) => [h.feature.id, h])).values()];
        return (
          <article key={a.id} className="assoc-card">
            <header>
              <GradeBadge grade={a.grade} />
              <strong>{processById.get(a.process)?.name}</strong>
            </header>
            <section>
              <h5>Detected feature that prompted this</h5>
              {features.map((h) => (
                <div key={h.feature.id} className="row wrap">
                  <strong>{featureById.get(h.feature.id)?.name}</strong>
                  <ConfidenceBadge f={h.feature} />
                  <span className="small muted">{h.feature.measurement}</span>
                </div>
              ))}
            </section>
            <section>
              <h5>Proposed process</h5>
              <p className="small">{processById.get(a.process)?.description}</p>
            </section>
            <section>
              <h5>Is applying this research to the segment direct?</h5>
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
            </section>
            <section>
              <h5>What the research says</h5>
              <p>{a.claim}</p>
              {target.precision === 'approximate' && (
                <p className="small callout">
                  Anatomical precision: the finding concerns {target.functionalLabel ?? 'a functional area'}; the highlighted atlas region is broader. {target.note ?? ''}
                </p>
              )}
              {target.precision === 'atlas' && target.note && <p className="small muted">{target.note}</p>}
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
            </section>
            <section>
              <h5>Sources and their findings</h5>
              {a.citations.map((c, i) => (
                <SourceCard key={`${c.source}-${i}`} id={c.source} role={c.role} finding={c.finding} />
              ))}
            </section>
            <section>
              <h5>Limitations</h5>
              <ul className="small">
                {a.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
                <li>Strong evidence for a general association does not mean strong evidence that this particular clip evokes the process.</li>
              </ul>
            </section>
          </article>
        );
      })}
    </div>
  );
}
