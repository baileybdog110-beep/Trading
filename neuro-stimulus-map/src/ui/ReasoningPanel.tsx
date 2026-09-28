import { featureById, meshIndex, networkById, processById, regionById } from '../evidence/db';
import type { SegmentMap } from '../pipeline/mapping';
import type { DetectedFeature, Modalities, Segment } from '../pipeline/types';
import { ApplicabilityBadge, ConfidenceBadge, GradeBadge } from './bits';
import { formatTime } from './format';

const OUTCOME_TEXT: Record<string, string> = {
  'rejected-by-user': 'Not applied: you rejected this feature.',
  'needs-confirmation': 'Not applied until a person confirms this interpretation (see Features tab).',
  'below-confidence': 'Not applied: detection confidence is below the level this rule requires.',
  'listener-context': 'Not applied: you indicated the listener condition does not hold.',
};

export function meshLabel(meshId: string): string {
  const info = meshIndex.get(meshId);
  if (!info) return meshId;
  const hemi = info.hemi === 'bilateral' ? '' : info.hemi === 'L' ? 'Left ' : 'Right ';
  const name = info.kind === 'region' ? regionById.get(info.id)?.name : networkById.get(info.id)?.name;
  return `${hemi}${name ?? meshId}`;
}

function ModalityStrip({ m }: { m: Modalities }) {
  const items: [string, Modalities[keyof Modalities]][] = [
    ['Audio', m.audio],
    ['Video', m.video],
    ['Faces', m.faces],
    ['Transcript', m.transcript],
  ];
  return (
    <ul className="modalities" aria-label="What was analysed">
      {items.map(([k, v]) => (
        <li key={k} className={`mod mod-${v.state}`} title={v.detail}>
          <strong>{k}</strong>
          <span>{v.state === 'analyzed' ? 'analysed' : v.state === 'not-present' ? 'not in file' : v.state === 'failed' ? 'failed' : 'not analysed'}</span>
        </li>
      ))}
    </ul>
  );
}

export function ReasoningPanel({
  segment,
  map,
  modalities,
  onSelectMesh,
  selectedMesh,
  focus,
  onFocus,
}: {
  segment: Segment;
  map: SegmentMap;
  modalities: Modalities;
  onSelectMesh: (id: string) => void;
  selectedMesh: string | null;
  focus: string | null;
  onFocus: (associationId: string | null) => void;
}) {
  const present = Object.values(segment.features).filter((f): f is DetectedFeature => !!f && f.present);
  const fired = map.steps.filter((s) => s.outcome.kind === 'fired');
  const notFired = map.steps.filter((s) => s.outcome.kind !== 'fired');
  const regions = [...map.meshes.values()].sort((a, b) => a.meshId.localeCompare(b.meshId));

  return (
    <div className="reasoning">
      <div className="seg-title">
        <h3>
          Segment {segment.index + 1} · {formatTime(segment.start)}–{formatTime(segment.end)}
        </h3>
        <span className="muted">{segment.label}</span>
      </div>
      <ModalityStrip m={modalities} />

      <ol className="chain">
        <li>
          <h4>
            <span className="step">1</span> Detected in the media
          </h4>
          {present.length === 0 && <p className="muted">No features detected in this segment.</p>}
          <ul className="feature-list">
            {present.map((f) => {
              const def = featureById.get(f.id);
              return (
                <li key={f.id} className={f.status === 'rejected' ? 'is-rejected' : ''}>
                  <div className="row wrap">
                    <strong>{def?.name ?? f.id}</strong>
                    {def?.kind === 'interpretation' && <span className="badge interp">Interpretation</span>}
                    <ConfidenceBadge f={f} />
                  </div>
                  <div className="muted small">{f.measurement}</div>
                </li>
              );
            })}
          </ul>
        </li>

        <li>
          <h4>
            <span className="step">2</span> Processes these features might involve
          </h4>
          {fired.length === 0 && <p className="muted">No mapping rule applies to the detected features.</p>}
          <ul className="process-list">
            {fired.map((s) => (
              <li key={s.rule.id}>
                <div className="proc-line">
                  <span className="muted">{featureById.get(s.rule.feature)?.name}</span> <span aria-hidden="true">→</span> <strong>{processById.get(s.rule.process)?.name}</strong>
                </div>
                <div className="row wrap">
                  <ApplicabilityBadge a={s.rule.applicability} />
                  {s.conditional && <span className="badge cond">Depends on the listener</span>}
                </div>
                <p className="small">{s.rule.rationale}</p>
                {s.rule.conditions.length > 0 && (
                  <p className="small muted">
                    Assumes: {s.rule.conditions.join(' ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {notFired.length > 0 && (
            <details className="small">
              <summary>{notFired.length} rule(s) not applied</summary>
              <ul>
                {notFired.map((s) => (
                  <li key={s.rule.id}>
                    {featureById.get(s.rule.feature)?.name} → {processById.get(s.rule.process)?.name}: {OUTCOME_TEXT[s.outcome.kind] ?? s.outcome.kind}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </li>

        <li>
          <h4>
            <span className="step">3</span> What published research associates with those processes
          </h4>
          <ul className="assoc-list">
            {fired.flatMap((s) => [
              ...s.associations.map((a) => (
                <li key={`${s.rule.id}-${a.id}`} className={focus === a.id ? 'is-focus' : ''}>
                  <div className="row wrap">
                    <GradeBadge grade={a.grade} />
                    <span className="muted small">via {featureById.get(s.rule.feature)?.name}</span>
                    <button type="button" className="btn small ghost push" aria-pressed={focus === a.id} onClick={() => onFocus(focus === a.id ? null : a.id)}>
                      {focus === a.id ? 'Show all on map' : 'Show only this on map'}
                    </button>
                  </div>
                  <p>{a.claim}</p>
                  <div className="targets">
                    {a.targets.map((t) => {
                      const meshes = [...map.meshes.values()].filter((m) => m.id === t.id && m.hits.some((h) => h.association.id === a.id));
                      return meshes.map((m) => (
                        <button key={m.meshId} type="button" className={`target ${selectedMesh === m.meshId ? 'is-selected' : ''}`} onClick={() => onSelectMesh(m.meshId)}>
                          {meshLabel(m.meshId)}
                          {t.precision === 'approximate' ? ' ≈' : ''}
                        </button>
                      ));
                    })}
                  </div>
                  <p className="small muted">{a.citations.filter((c) => c.role === 'supports').length} supporting source(s); open a region for findings and limitations.</p>
                </li>
              )),
              ...s.unsupported.map((u) => (
                <li key={`${s.rule.id}-${u.id}`} className="insufficient">
                  <GradeBadge grade="insufficient" />
                  <p>
                    <strong>{u.topic}:</strong> {u.reason}
                  </p>
                </li>
              )),
            ])}
          </ul>
          {map.featureNotes.length > 0 && (
            <div className="notes">
              <h5>Not mapped on purpose</h5>
              <ul className="small">
                {map.featureNotes.map((u) => (
                  <li key={u.id}>
                    <strong>{u.topic}.</strong> {u.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      </ol>

      <h4>Highlighted regions and networks ({regions.length})</h4>
      <p className="small muted">Accessible list of everything coloured on the map. "≈" marks a functional area that the atlas region only approximates.</p>
      <table className="region-table">
        <thead>
          <tr>
            <th>Region / network</th>
            <th>Best evidence</th>
            <th>From</th>
          </tr>
        </thead>
        <tbody>
          {regions.map((r) => (
            <tr key={r.meshId} className={selectedMesh === r.meshId ? 'is-selected' : ''}>
              <td>
                <button type="button" className="linklike" onClick={() => onSelectMesh(r.meshId)}>
                  {meshLabel(r.meshId)}
                  {r.kind === 'network' ? ' (network view)' : ''}
                </button>
              </td>
              <td>
                <GradeBadge grade={r.grade} />
              </td>
              <td className="small">{[...new Set(r.hits.map((h) => processById.get(h.association.process)?.name))].join('; ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
