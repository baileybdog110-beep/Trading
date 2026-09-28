import { useMemo, useRef } from 'react';
import type { AnalysisSession, Segment } from '../pipeline/types';
import { formatTime } from './format';

interface Props {
  session: AnalysisSession;
  segments: Segment[];
  selectedId: string | null;
  time: number;
  onSelect: (seg: Segment) => void;
  onSeek: (t: number) => void;
}

const LANE_H = 18;

function Sparkline({ values, step, duration, min, max, label }: { values: number[]; step: number; duration: number; min: number; max: number; label: string }) {
  const d = useMemo(() => {
    if (!values.length) return '';
    const pts = values.map((v, i) => {
      const x = ((i * step) / duration) * 1000;
      const y = LANE_H - ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (LANE_H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M0,${LANE_H} L${pts.join(' L')} L${((values.length * step) / duration) * 1000},${LANE_H} Z`;
  }, [values, step, duration, min, max]);
  return (
    <svg className="lane-svg" viewBox={`0 0 1000 ${LANE_H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={d} className="lane-area" />
    </svg>
  );
}

function Ticks({ times, duration, label }: { times: number[]; duration: number; label: string }) {
  return (
    <svg className="lane-svg" viewBox={`0 0 1000 ${LANE_H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {times.map((t, i) => (
        <line key={i} x1={(t / duration) * 1000} x2={(t / duration) * 1000} y1={2} y2={LANE_H - 2} className="lane-tick" />
      ))}
    </svg>
  );
}

export function Timeline({ session, segments, selectedId, time, onSelect, onSeek }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { duration, tracks } = session;
  const lanes: { key: string; label: string; node: React.ReactNode }[] = [];
  if (tracks.level) lanes.push({ key: 'level', label: 'Level (dB)', node: <Sparkline values={tracks.level} step={tracks.step} duration={duration} min={-70} max={0} label="Audio level over time" /> });
  if (tracks.speech) lanes.push({ key: 'speech', label: 'Speech-like', node: <Sparkline values={tracks.speech} step={tracks.step} duration={duration} min={0} max={1} label="Speech-likeness score over time" /> });
  if (tracks.music) lanes.push({ key: 'music', label: 'Music-like', node: <Sparkline values={tracks.music} step={tracks.step} duration={duration} min={0} max={1} label="Music-likeness score over time" /> });
  if (tracks.onsets) lanes.push({ key: 'onsets', label: 'Sudden sounds', node: <Ticks times={tracks.onsets} duration={duration} label="Abrupt sound onsets" /> });
  if (tracks.motion) lanes.push({ key: 'motion', label: 'Motion', node: <Sparkline values={tracks.motion} step={tracks.step} duration={duration} min={0} max={1} label="Visual motion proxy over time" /> });
  if (tracks.cuts) lanes.push({ key: 'cuts', label: 'Cuts', node: <Ticks times={tracks.cuts} duration={duration} label="Detected shot changes" /> });
  if (tracks.faces) lanes.push({ key: 'faces', label: 'Faces', node: <Sparkline values={tracks.faces} step={tracks.step} duration={duration} min={0} max={1} label="Face present in sampled frames" /> });

  const seekFromEvent = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    onSeek(Math.max(0, Math.min(duration, t)));
  };

  return (
    <section className="timeline" aria-label="Timeline of detected content features">
      <div className="timeline-head">
        <h2>Timeline</h2>
        <p className="muted small">Lanes show features measured in the media, not brain activity. Each block is one segment; the map changes only when the segment changes.</p>
      </div>
      <div className="timeline-grid">
        <div className="lane-labels" aria-hidden="true">
          <div className="lane-label seg-label">Segments</div>
          {lanes.map((l) => (
            <div key={l.key} className="lane-label">
              {l.label}
            </div>
          ))}
        </div>
        <div className="lanes" ref={ref} onPointerDown={seekFromEvent}>
          <div className="seg-row" role="listbox" aria-label="Segments">
            {segments.map((s) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === selectedId}
                className={`seg-block ${s.id === selectedId ? 'is-selected' : ''}`}
                style={{ left: `${(s.start / duration) * 100}%`, width: `${((s.end - s.start) / duration) * 100}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelect(s)}
                title={`${s.index + 1}. ${s.label} (${formatTime(s.start)}–${formatTime(s.end)})`}
              >
                <span className="seg-num">{s.index + 1}</span>
                <span className="seg-text">{s.label}</span>
              </button>
            ))}
          </div>
          {lanes.map((l) => (
            <div key={l.key} className="lane">
              {l.node}
            </div>
          ))}
          <div className="playhead" style={{ left: `${(time / duration) * 100}%` }} aria-hidden="true" />
        </div>
      </div>
      <div className="timeline-axis mono small" aria-hidden="true">
        <span>0:00</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </section>
  );
}
