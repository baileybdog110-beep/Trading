import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { db } from './evidence/db';
import { validateEvidenceDB } from './evidence/validate';
import '@fontsource-variable/source-sans-3/wght.css';
import '@fontsource-variable/source-serif-4/wght.css';
import './styles.css';

// Refuse to render mappings from an inconsistent evidence database.
const problems = validateEvidenceDB(db);
const root = createRoot(document.getElementById('root')!);
if (problems.length) {
  root.render(
    <div className="fatal">
      <h1>Evidence database failed validation</h1>
      <p>The map is disabled until these problems are fixed in data/evidence/:</p>
      <ul>
        {problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
