import { useEffect, useRef, type ReactNode } from 'react';
import { sourceById } from '../evidence/db';
import type { Applicability, EvidenceGrade, SourceRecord } from '../evidence/types';
import type { DetectedFeature } from '../pipeline/types';
import { APPLICABILITY_LABEL, GRADE_LABEL } from './colors';

export function GradeBadge({ grade }: { grade: EvidenceGrade | 'insufficient' }) {
  const text = grade === 'insufficient' ? 'Insufficient evidence' : GRADE_LABEL[grade];
  return (
    <span className={`badge grade grade-${grade}`}>
      <span className="swatch" aria-hidden="true" />
      {text}
    </span>
  );
}

export function ApplicabilityBadge({ a }: { a: Applicability }) {
  return <span className={`badge appl appl-${a}`}>{APPLICABILITY_LABEL[a]}</span>;
}

export function ConfidenceBadge({ f }: { f: DetectedFeature }) {
  if (f.status === 'confirmed') return <span className="badge conf conf-user">Confirmed by you</span>;
  if (f.status === 'rejected') return <span className="badge conf conf-rejected">Rejected by you</span>;
  if (f.status === 'suggested') return <span className="badge conf conf-suggested">Suggestion · needs review</span>;
  return <span className={`badge conf conf-${f.confidence}`}>Detection: {f.confidence}</span>;
}

export function Verification({ s }: { s: SourceRecord }) {
  const label =
    s.verification.level === 'full-text'
      ? 'Checked against full text'
      : s.verification.level === 'abstract'
        ? 'Checked against abstract'
        : 'Checked via search-index records (abstract-level); full text not read';
  return (
    <span className="verif" title={s.verification.notes ?? ''}>
      {label} · {s.verification.checkedOn}
    </span>
  );
}

export function SourceLinks({ s }: { s: SourceRecord }) {
  return (
    <span className="links">
      {s.doi && (
        <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
          doi:{s.doi}
        </a>
      )}
      {s.pmid && (
        <a href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`} target="_blank" rel="noreferrer">
          PMID {s.pmid}
        </a>
      )}
      {!s.doi && !s.pmid && (
        <a href={s.url} target="_blank" rel="noreferrer">
          Publisher / record
        </a>
      )}
    </span>
  );
}

export function SourceCard({ id, role, finding }: { id: string; role?: 'supports' | 'qualifies' | 'conflicts'; finding?: string }) {
  const s = sourceById.get(id);
  if (!s) return <div className="source missing">Unknown source {id}</div>;
  return (
    <div className={`source ${role ? `role-${role}` : ''}`}>
      <div className="source-head">
        {role && <span className={`role role-${role}`}>{role === 'supports' ? 'Supports' : role === 'qualifies' ? 'Qualifies' : 'Conflicts'}</span>}
        <strong>{s.shortCite}</strong>
        <span className="muted">
          {' '}
          · {s.design}
          {s.n ? ` · n = ${s.n}` : ' · sample size not verified here'}
          {s.naturalistic ? ' · naturalistic stimuli' : ''}
        </span>
      </div>
      {finding && <p className="finding">{finding}</p>}
      <details>
        <summary>Study details & citation</summary>
        <dl className="kv">
          <dt>Citation</dt>
          <dd>
            {s.authors} ({s.year}). {s.title}. <em>{s.venue}</em>
            {s.details ? `, ${s.details}` : ''}. <SourceLinks s={s} />
          </dd>
          <dt>Method</dt>
          <dd>{s.method}</dd>
          <dt>Population</dt>
          <dd>{s.population}</dd>
          <dt>Stimuli</dt>
          <dd>{s.stimuli}</dd>
          <dt>Comparison</dt>
          <dd>{s.comparison}</dd>
          <dt>Key findings</dt>
          <dd>
            <ul>
              {s.keyFindings.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </dd>
          <dt>Limitations</dt>
          <dd>
            <ul>
              {s.limitations.map((k, i) => (
                <li key={i}>{k}</li>
              ))}
            </ul>
          </dd>
          <dt>Verification</dt>
          <dd>
            <Verification s={s} />
            {s.verification.notes && <div className="muted small">{s.verification.notes}</div>}
          </dd>
        </dl>
      </details>
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // keep the latest onClose without re-running the focus effect (parents re-render often, e.g. during playback)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, []);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
