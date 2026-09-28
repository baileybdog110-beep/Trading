import { useState } from 'react';
import { db, featureById, networkById, processById, regionById } from '../evidence/db';
import { ApplicabilityBadge, GradeBadge, JsonExportButton, Modal, SourceCard, SourceLinks, Verification } from './bits';

type Tab = 'associations' | 'sources' | 'rules' | 'unsupported' | 'rubric';

export function EvidenceBrowser({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('associations');
  return (
    <Modal title="Evidence database" onClose={onClose} wide>
      <p className="small">
        Every coloured region comes from one of these records. The database lives in <code>data/evidence/*.json</code>, separate from the interface, and is validated automatically
        (every association must cite at least one supporting source). Version {db.meta.version}, curated {db.meta.curatedOn}.
      </p>
      <p className="small callout">{db.meta.verificationStatement}</p>
      <div className="tabs" role="tablist">
        {(
          [
            ['associations', `Associations (${db.associations.length})`],
            ['sources', `Sources (${db.sources.length})`],
            ['rules', `Feature → process rules (${db.rules.length})`],
            ['unsupported', `Not mapped (${db.unsupported.length})`],
            ['rubric', 'Grading rubric'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
        <JsonExportButton label="JSON" filename={`evidence-db-${db.meta.version}.json`} data={() => db} />
      </div>

      {tab === 'associations' && (
        <div className="table-wrap">
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Process</th>
                <th>Regions / networks</th>
                <th>Grade</th>
                <th>Claim & sources</th>
              </tr>
            </thead>
            <tbody>
              {db.associations.map((a) => (
                <tr key={a.id}>
                  <td>{processById.get(a.process)?.name}</td>
                  <td className="small">
                    {a.targets.map((t) => (
                      <div key={t.id + t.hemi}>
                        {t.kind === 'region' ? regionById.get(t.id)?.name : networkById.get(t.id)?.name} ({t.hemi === 'both' ? 'both' : t.hemi}){t.precision === 'approximate' ? ' ≈' : ''}
                      </div>
                    ))}
                  </td>
                  <td>
                    <GradeBadge grade={a.grade} />
                  </td>
                  <td className="small">
                    <p>{a.claim}</p>
                    <details>
                      <summary>{a.citations.length} citation(s), rationale and limitations</summary>
                      <dl className="kv">
                        <dt>Consistency</dt>
                        <dd>{a.gradeRationale.consistency}</dd>
                        <dt>Quality</dt>
                        <dd>{a.gradeRationale.quality}</dd>
                        <dt>Directness</dt>
                        <dd>{a.gradeRationale.directness}</dd>
                        <dt>Replication</dt>
                        <dd>{a.gradeRationale.replication}</dd>
                      </dl>
                      {a.citations.map((c, i) => (
                        <SourceCard key={i} id={c.source} role={c.role} finding={c.finding} />
                      ))}
                      <ul>
                        {a.limitations.map((l, i) => (
                          <li key={i}>{l}</li>
                        ))}
                      </ul>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'sources' && (
        <div className="table-wrap">
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Design & sample</th>
                <th>Stimuli / comparison</th>
                <th>Naturalistic</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {db.sources.map((s) => (
                <tr key={s.id}>
                  <td className="small">
                    <strong>{s.shortCite}</strong>. {s.title}. <em>{s.venue}</em>. <SourceLinks s={s} />
                  </td>
                  <td className="small">
                    {s.design}
                    <br />
                    {s.n ? `n = ${s.n}` : <span className="muted">n not verified</span>}
                  </td>
                  <td className="small">
                    {s.stimuli}
                    <br />
                    <span className="muted">{s.comparison}</span>
                  </td>
                  <td className="small">{s.naturalistic ? 'Yes' : 'No'}</td>
                  <td className="small">
                    <Verification s={s} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'rules' && (
        <div className="table-wrap">
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Detected feature</th>
                <th>Candidate process</th>
                <th>Applicability</th>
                <th>Rationale & assumptions</th>
              </tr>
            </thead>
            <tbody>
              {db.rules.map((r) => (
                <tr key={r.id}>
                  <td className="small">
                    {featureById.get(r.feature)?.name}
                    <div className="muted">min. detection: {r.minConfidence}{r.requiresConfirmation ? ' · needs confirmation' : ''}</div>
                  </td>
                  <td className="small">{processById.get(r.process)?.name}</td>
                  <td>
                    <ApplicabilityBadge a={r.applicability} />
                  </td>
                  <td className="small">
                    {r.rationale}
                    {r.conditions.length > 0 && <div className="muted">Assumes: {r.conditions.join(' ')}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'unsupported' && (
        <ul className="unsupported-list">
          {db.unsupported.map((u) => (
            <li key={u.id}>
              <GradeBadge grade="insufficient" /> <strong>{u.topic}</strong>
              <p className="small">{u.reason}</p>
            </li>
          ))}
        </ul>
      )}

      {tab === 'rubric' && (
        <div>
          <h3>Evidence strength (the research)</h3>
          <dl className="kv">
            {Object.entries(db.meta.gradingRubric).map(([k, v]) => (
              <div key={k}>
                <dt>
                  <GradeBadge grade={k as never} />
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h3>Applicability (research → this segment)</h3>
          <dl className="kv">
            {Object.entries(db.meta.applicabilityRubric).map(([k, v]) => (
              <div key={k}>
                <dt>
                  <ApplicabilityBadge a={k as never} />
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <h3>Detection confidence (the software)</h3>
          <p className="small">
            Low / moderate / high describes how sure the detector is that a feature is present in the media. Heuristic detectors never report "high". It is independent of evidence
            strength.
          </p>
        </div>
      )}
    </Modal>
  );
}
