import { db } from '../evidence/db';
import type { FeatureDefinition, FeatureId, Modality } from '../evidence/types';
import type { DetectedFeature, Modalities, Segment } from '../pipeline/types';
import { ConfidenceBadge } from './bits';

const MOD_ORDER: { m: Modality; label: string; key: keyof Modalities | null }[] = [
  { m: 'audio', label: 'Audio', key: 'audio' },
  { m: 'transcript', label: 'Language (transcript)', key: 'transcript' },
  { m: 'video', label: 'Video', key: 'video' },
  { m: 'user', label: 'Your annotations & interpretations', key: null },
];

interface Props {
  segment: Segment;
  modalities: Modalities;
  onConfirm: (id: FeatureId) => void;
  onReject: (id: FeatureId) => void;
  onReset: (id: FeatureId) => void;
  overridden: Set<FeatureId>;
}

function FeatureRow({ def, f, analysed, props }: { def: FeatureDefinition; f: DetectedFeature | undefined; analysed: boolean; props: Props }) {
  const isOver = props.overridden.has(def.id);
  return (
    <li className={`feat ${f?.present && f.status !== 'rejected' ? 'is-on' : ''}`}>
      <div className="row wrap">
        <strong>{def.name}</strong>
        {def.kind === 'interpretation' && <span className="badge interp">Interpretation</span>}
        {f ? f.present || f.status === 'rejected' ? <ConfidenceBadge f={f} /> : <span className="badge conf conf-absent">Not detected</span> : analysed ? null : <span className="badge conf conf-na">Not analysed</span>}
      </div>
      <div className="small muted">{f ? f.measurement : analysed || def.modality === 'user' ? def.howDetected : 'This modality was not analysed, so nothing is inferred.'}</div>
      <details className="small">
        <summary>How it is detected & limits</summary>
        <p>{def.howDetected}</p>
        <p className="muted">{def.limitations}</p>
      </details>
      <div className="feat-actions">
        {f?.status === 'suggested' ? (
          <>
            <button type="button" className="btn small" onClick={() => props.onConfirm(def.id)}>
              Confirm
            </button>
            <button type="button" className="btn small ghost" onClick={() => props.onReject(def.id)}>
              Dismiss
            </button>
          </>
        ) : f?.present && f.status !== 'rejected' ? (
          <>
            {f.status === 'auto' && (
              <button type="button" className="btn small ghost" onClick={() => props.onConfirm(def.id)}>
                Confirm
              </button>
            )}
            <button type="button" className="btn small ghost" onClick={() => props.onReject(def.id)}>
              Reject
            </button>
          </>
        ) : (
          <button type="button" className="btn small" onClick={() => props.onConfirm(def.id)}>
            Mark present
          </button>
        )}
        {isOver && (
          <button type="button" className="btn small ghost" onClick={() => props.onReset(def.id)}>
            Undo my change
          </button>
        )}
      </div>
    </li>
  );
}

export function FeaturePanel(props: Props) {
  const { segment, modalities } = props;
  return (
    <div className="feature-panel">
      <p className="small muted">
        Detection confidence says how sure the software is that a feature is in the media. It is separate from evidence strength, which describes the research. Corrections apply to
        this segment only and update the map immediately.
      </p>
      {MOD_ORDER.map(({ m, label, key }) => {
        const state = key ? modalities[key] : null;
        const analysed = !state || state.state === 'analyzed';
        const defs = db.features.filter((d) => d.modality === m);
        return (
          <section key={m} className="feat-group">
            <h4>
              {label}
              {state && state.state !== 'analyzed' && <span className="badge conf conf-na">{state.state === 'not-present' ? 'Not in this file' : state.state === 'failed' ? 'Failed' : 'Not analysed'}</span>}
            </h4>
            {state && state.state !== 'analyzed' && <p className="small muted">{state.detail}</p>}
            <ul>
              {defs.map((def) => (
                <FeatureRow key={def.id} def={def} f={segment.features[def.id]} analysed={analysed} props={props} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
