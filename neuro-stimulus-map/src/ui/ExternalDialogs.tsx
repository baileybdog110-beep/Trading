import { useState } from 'react';
import { ASR_MODELS, type AsrModelKey } from '../analysis/transcript/asr';
import { LLM_MODEL } from '../analysis/transcript/llm';
import { Modal } from './bits';

export function AsrDialog({ onClose, onStart }: { onClose: () => void; onStart: (m: AsrModelKey) => void }) {
  const [model, setModel] = useState<AsrModelKey>('english-tiny');
  const [ok, setOk] = useState(false);
  return (
    <Modal title="Optional: local speech recognition (experimental)" onClose={onClose}>
      <p>This creates a timed transcript with the Whisper model running inside your browser.</p>
      <ul className="small">
        <li>
          <strong>Downloads:</strong> the transformers.js library and ONNX Runtime WebAssembly files from <code>cdn.jsdelivr.net</code>, and model weights (tens of megabytes) from{' '}
          <code>huggingface.co</code>. Those services see a normal download request from your browser.
        </li>
        <li>
          <strong>Your audio is not sent anywhere.</strong> It is decoded and transcribed locally. Your browser may cache the model files; clear site data to remove them.
        </li>
        <li>Transcription can be slow on long files and may contain errors. Review the transcript before relying on language features.</li>
        <li>This path could not be tested in the environment where the app was built (those hosts were not reachable), so treat it as experimental.</li>
      </ul>
      <label className="small">
        Model{' '}
        <select value={model} onChange={(e) => setModel(e.target.value as AsrModelKey)}>
          {Object.entries(ASR_MODELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      <label className="check small">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I understand what will be downloaded and that audio stays on this device.
      </label>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!ok} onClick={() => onStart(model)}>
          Download model & transcribe
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export function LlmDialog({ segmentCount, onClose, onStart }: { segmentCount: number; onClose: () => void; onStart: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [ok, setOk] = useState(false);
  return (
    <Modal title="Optional: suggest interpretations with Claude" onClose={onClose}>
      <p>
        An LLM can <em>suggest</em> interpretive labels - humor, suspense, surprise, emotional theme, situation change - for segments that have transcript text.
      </p>
      <ul className="small">
        <li>
          <strong>What is sent:</strong> transcript text and start/end times for {segmentCount} segment(s), to Anthropic's API (<code>api.anthropic.com</code>, model{' '}
          <code>{LLM_MODEL}</code>, with Anthropic's default server-side fallback if the request is declined). No audio, video or file names are sent.
        </li>
        <li>
          <strong>Retention:</strong> Anthropic processes the text under its API terms and data-retention policy for your account. This app keeps the key in memory for this request only
          and stores nothing.
        </li>
        <li>
          <strong>What the model can and cannot do here:</strong> it can only propose labels from a fixed list, with a quote from the segment. It never chooses brain regions. Suggestions
          appear as "needs review" and do not affect the map until you confirm them.
        </li>
        <li>Using your key incurs API charges on your account.</li>
      </ul>
      <label className="small block">
        Anthropic API key
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-..." />
      </label>
      <label className="check small">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Send the transcript text described above.
      </label>
      <div className="actions">
        <button type="button" className="btn primary" disabled={!ok || !key.trim()} onClick={() => onStart(key.trim())}>
          Request suggestions
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
