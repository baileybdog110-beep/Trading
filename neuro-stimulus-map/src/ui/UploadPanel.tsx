import { useRef, useState } from 'react';
import { SUPPORTED_EXT, type Progress } from '../analysis/run';
import { HOSTED, HOSTED_NETWORK_NOTE } from '../util/hosted';

const TRANSCRIPT_EXT = ['srt', 'vtt', 'txt', 'json'];
const ext = (n: string) => n.toLowerCase().split('.').pop() ?? '';

interface Props {
  busy: boolean;
  progress: Progress | null;
  error: string | null;
  onAnalyze: (media: File, transcript: File | null, opts: { faces: boolean }) => void;
  onTranscriptOnly: (transcript: File) => void;
  onDemo: () => void;
  onCancel: () => void;
}

export function UploadPanel({ busy, progress, error, onAnalyze, onTranscriptOnly, onDemo, onCancel }: Props) {
  const [media, setMedia] = useState<File | null>(null);
  const [transcript, setTranscript] = useState<File | null>(null);
  const [faces, setFaces] = useState(true);
  const [drag, setDrag] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const take = (files: FileList | null) => {
    if (!files) return;
    setWarn(null);
    for (const f of Array.from(files)) {
      const e = ext(f.name);
      if (TRANSCRIPT_EXT.includes(e)) setTranscript(f);
      else if (SUPPORTED_EXT.includes(e) || f.type.startsWith('audio/') || f.type.startsWith('video/')) setMedia(f);
      else setWarn(`"${f.name}" is not a supported media or transcript file.`);
    }
  };

  const picked = !!(media || transcript);
  return (
    <section className="upload" aria-label="Load media">
      <div
        className={`dropzone ${drag ? 'is-drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          take(e.dataTransfer.files);
        }}
      >
        <svg className="drop-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
        </svg>
        <p className="drop-title">Drop a video, song or podcast here</p>
        <button type="button" className={`btn ${picked ? '' : 'primary'}`} onClick={() => input.current?.click()} disabled={busy}>
          {picked ? 'Choose different files' : 'Choose files'}
        </button>
        <p className="muted small drop-formats">MP4, MOV, MP3, WAV, M4A, WebM, OGG or FLAC, depending on your browser. You can add a transcript (SRT, VTT, JSON or TXT) too.</p>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept={[...SUPPORTED_EXT, ...TRANSCRIPT_EXT].map((e) => `.${e}`).join(',') + ',audio/*,video/*'}
          onChange={(e) => take(e.target.files)}
        />
      </div>
      {warn && <p className="error small">{warn}</p>}

      {picked && (
        <div className="picked-box">
          <ul className="picked small">
            {media && (
              <li>
                <span className="picked-kind">Media</span>
                <span className="picked-name">{media.name}</span>
                <span className="muted">{(media.size / 1e6).toFixed(1)} MB</span>
                <button type="button" className="linklike" onClick={() => setMedia(null)} disabled={busy}>
                  Remove
                </button>
              </li>
            )}
            {transcript && (
              <li>
                <span className="picked-kind">Transcript</span>
                <span className="picked-name">{transcript.name}</span>
                <button type="button" className="linklike" onClick={() => setTranscript(null)} disabled={busy}>
                  Remove
                </button>
              </li>
            )}
          </ul>
          {media && (
            <label className="check small">
              <input type="checkbox" checked={faces} onChange={(e) => setFaces(e.target.checked)} disabled={busy} /> Detect whether faces are visible (local model; no identity or
              expression analysis)
            </label>
          )}
          <div className="actions">
            {media && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => onAnalyze(media, transcript, { faces })}>
                Analyse locally
              </button>
            )}
            {!media && transcript && (
              <button type="button" className="btn primary" disabled={busy} onClick={() => onTranscriptOnly(transcript)}>
                Analyse transcript only
              </button>
            )}
          </div>
        </div>
      )}

      {busy && progress && (
        <div className="progress" role="status" aria-live="polite">
          <div className="bar">
            <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
          <span className="small">
            {progress.stage === 'audio' ? 'Step 1/3 · ' : progress.stage === 'video' ? 'Step 2/3 · ' : progress.stage === 'assemble' ? 'Step 3/3 · ' : ''}
            {progress.note}
          </span>
          <button type="button" className="btn small ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <div className="demo-row">
        <span className="small muted">No file to hand?</span>
        <button type="button" className="btn" disabled={busy} onClick={onDemo}>
          Explore demo data
        </button>
      </div>

      <details className="privacy">
        <summary>
          <svg className="lock" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Private: your media never leaves this device
        </summary>
        <p className="small">
          Decoding, audio features, frame sampling and face detection run inside this browser tab. Nothing is uploaded, and nothing is saved to disk; closing the tab or pressing{' '}
          <em>Delete media & results</em> discards it.
        </p>
        {HOSTED ? (
          <p className="small muted">{HOSTED_NETWORK_NOTE}</p>
        ) : (
          <p className="small muted">
            Two optional tools contact outside services and are off until you turn them on later, each with its own explanation first: local speech recognition (downloads a model;
            audio stays here) and interpretation suggestions (sends transcript text to Anthropic with your own API key).
          </p>
        )}
      </details>
    </section>
  );
}
