import { forwardRef, useEffect, useRef } from 'react';
import type { AnalysisSession, TranscriptCue } from '../pipeline/types';
import { JsonExportButton } from './bits';
import { formatTime } from './format';

interface Props {
  session: AnalysisSession;
  url: string | null;
  onTime: (t: number) => void;
  /** extra controls under the player (play controls when there is no media file) */
  children?: React.ReactNode;
}

export const MediaPanel = forwardRef<HTMLMediaElement, Props>(function MediaPanel({ session, url, onTime, children }, ref) {
  const common = {
    controls: true,
    src: url ?? undefined,
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => onTime(e.currentTarget.currentTime),
    onSeeked: (e: React.SyntheticEvent<HTMLMediaElement>) => onTime(e.currentTarget.currentTime),
  };
  return (
    <section className="media" aria-label="Media player">
      <div className="media-head">
        <div>
          <h2 className="media-name" title={session.mediaName}>
            {session.mediaName}
          </h2>
          <p className="muted small">
            {formatTime(session.duration)} · {session.segments.length} segments · {session.isDemo ? 'demonstration data' : `analysed ${new Date(session.createdAt).toLocaleTimeString()}`}
          </p>
        </div>
      </div>
      {session.mediaKind === 'video' && url && <video ref={ref as React.Ref<HTMLVideoElement>} {...common} playsInline className="player" />}
      {session.mediaKind === 'audio' && url && <audio ref={ref as React.Ref<HTMLAudioElement>} {...common} className="player audio" />}
      {session.mediaKind === 'none' && (
        <div className="no-media small muted">
          {session.isDemo ? 'The demo has no media file. Press Play to run the heat map through its fictional 2:40 timeline.' : 'No media file: transcript-only analysis. Press Play to step through the transcript.'}
        </div>
      )}
      {children}
    </section>
  );
});

/** Export and delete (and, in the Evidence view, whether the segment follows playback). */
export function MediaActions({
  session,
  follow,
  onFollow,
  onDelete,
  exportData,
}: {
  session: AnalysisSession;
  follow?: boolean;
  onFollow?: (v: boolean) => void;
  onDelete: () => void;
  exportData: () => unknown;
}) {
  return (
    <div className="media-actions">
      {onFollow && (
        <label className="check small">
          <input type="checkbox" checked={!!follow} onChange={(e) => onFollow(e.target.checked)} /> Segment follows playback
        </label>
      )}
      <JsonExportButton label="analysis (JSON)" filename={`brain-heat-map-${session.isDemo ? 'demo' : 'analysis'}.json`} data={exportData} />
      <button type="button" className="btn small danger" onClick={onDelete}>
        {session.isDemo ? 'Close demo' : 'Delete media & results'}
      </button>
    </div>
  );
}

export function TranscriptPanel({
  cues,
  time,
  onSeek,
  untimed,
  children,
}: {
  cues: TranscriptCue[];
  time: number;
  onSeek: (t: number) => void;
  untimed?: string;
  children?: React.ReactNode;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const active = cues.findIndex((c) => time >= c.start && time < c.end);
  useEffect(() => {
    if (active < 0) return;
    const list = listRef.current;
    const el = list?.children[active] as HTMLElement | undefined;
    if (!list || !el) return;
    // scroll only the transcript list, never the page
    const d = el.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (d < 0 || d > list.clientHeight - el.offsetHeight) list.scrollTop += d - 8;
  }, [active]);
  return (
    <section className="transcript" aria-label="Transcript">
      <div className="transcript-head">
        <h2>Transcript</h2>
        {children}
      </div>
      {cues.length === 0 && !untimed && <p className="muted small">No transcript. Add an SRT/VTT/JSON file with timestamps, or use optional local speech recognition.</p>}
      {untimed && cues.length === 0 && (
        <>
          <p className="small callout">Untimed transcript: it cannot be aligned to segments, so no per-segment language features were computed.</p>
          <p className="small untimed">{untimed.slice(0, 4000)}</p>
        </>
      )}
      <ol className="cues" ref={listRef}>
        {cues.map((c, i) => (
          <li key={i} className={i === active ? 'is-active' : ''}>
            <button type="button" className="cue" onClick={() => onSeek(c.start)}>
              <span className="mono ts">{formatTime(c.start)}</span>
              <span>{c.text}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
