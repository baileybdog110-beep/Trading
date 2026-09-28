import { useRef, useState } from 'react';
import { SUPPORTED_EXT, type Progress } from '../analysis/run';

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
        <p className="drop-title">Drop a video, song or podcast here</p>
        <p className="muted small">MP4, MOV, MP3, WAV, M4A, WEBM, OGG, FLAC - what plays depends on your browser's codecs. Optionally add a transcript (SRT, VTT, JSON or TXT).</p>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
          Choose files
        </button>
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

      {(media || transcript) && (
        <ul className="picked small">
          {media && (
            <li>
              <strong>Media:</strong> {media.name} · {(media.size / 1e6).toFixed(1)} MB
              <button type="button" className="linklike" onClick={() => setMedia(null)} disabled={busy}>
                remove
              </button>
            </li>
          )}
          {transcript && (
            <li>
              <strong>Transcript:</strong> {transcript.name}
              <button type="button" className="linklike" onClick={() => setTranscript(null)} disabled={busy}>
                remove
              </button>
            </li>
          )}
        </ul>
      )}

      <div className="privacy">
        <h3>Where your media goes</h3>
        <p className="small">
          <strong>Nowhere.</strong> Decoding, audio features, frame sampling and face detection run inside this browser tab. Nothing is uploaded, and nothing is saved to disk; closing the
          tab or pressing <em>Delete media & results</em> discards it.
        </p>
        <p className="small muted">
          Two optional tools contact outside services and are off until you turn them on later, each with its own explanation first: local speech recognition (downloads a model; audio
          stays here) and interpretation suggestions (sends transcript text to Anthropic with your own API key).
        </p>
        <label className="check small">
          <input type="checkbox" checked={faces} onChange={(e) => setFaces(e.target.checked)} disabled={busy} /> Detect whether faces are visible (local model; no identity or expression
          analysis)
        </label>
      </div>

      <div className="actions">
        <button type="button" className="btn primary" disabled={!media || busy} onClick={() => media && onAnalyze(media, transcript, { faces })}>
          Analyse locally
        </button>
        {!media && transcript && (
          <button type="button" className="btn" disabled={busy} onClick={() => onTranscriptOnly(transcript)}>
            Analyse transcript only
          </button>
        )}
        <button type="button" className="btn ghost" disabled={busy} onClick={onDemo}>
          Explore demo data
        </button>
      </div>

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
    </section>
  );
}
