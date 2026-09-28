import type { ListenerContext } from '../pipeline/types';
import { GRADE_SHORT } from './colors';

export function Legend() {
  return (
    <div className="legend" aria-label="Colour legend">
      <span className="legend-title">Research evidence linking the area to this content</span>
      <ul>
        {(['strong', 'moderate', 'limited', 'contested'] as const).map((g) => (
          <li key={g}>
            <span className={`swatch big grade-${g}`} aria-hidden="true" />
            {GRADE_SHORT[g]}
            {g === 'contested' ? ' (conflicting)' : ''}
          </li>
        ))}
        <li>
          <span className="swatch big grade-none" aria-hidden="true" />
          No verified link
        </li>
      </ul>
      <p className="legend-note">Colours show the strength of published research, not brain activity. Gray means no verified link for this segment, not "inactive".</p>
    </div>
  );
}

const QUESTIONS: { key: keyof ListenerContext; q: string }[] = [
  { key: 'understands_language', q: 'Does the listener understand the spoken language?' },
  { key: 'enjoys_music', q: 'Does the listener find this music pleasurable or moving?' },
  { key: 'finds_funny', q: 'Does the listener find the marked humor funny?' },
];

export function ListenerContextCard({ ctx, onChange }: { ctx: ListenerContext; onChange: (c: ListenerContext) => void }) {
  return (
    <details className="listener">
      <summary>About the listener (optional)</summary>
      <p className="small muted">
        Some findings only apply to people who understand, enjoy or are amused by the content. "Unknown" keeps those associations but marks them as conditional; "No" removes them.
        Nothing is stored.
      </p>
      {QUESTIONS.map(({ key, q }) => (
        <label key={key} className="listener-q small">
          <span>{q}</span>
          <select value={ctx[key]} onChange={(e) => onChange({ ...ctx, [key]: e.target.value as ListenerContext[typeof key] })}>
            <option value="unknown">Unknown</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      ))}
    </details>
  );
}
