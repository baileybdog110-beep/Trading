import { useEffect, useRef, useState } from 'react';
import { meshIndex, networkById, regionById } from '../evidence/db';
import type { PlayClock } from '../heat/clock';
import { HEAT_GRADIENT, heatCSS } from '../heat/colors';
import { SYSTEMS, heatWord, type HeatModel } from '../heat/model';
import { formatTime } from './format';

/** Plain statement of what the heat is, shared by the legend and the panel. */
export const HEAT_DISCLAIMER =
  "Worked out from what's in the media at each moment and the published research on it. It is not a recording of brain activity, and it can't show feelings, thoughts or dopamine.";

export function HeatLegend() {
  return (
    <div className="legend heat-legend" aria-label="Heat colour scale">
      <span className="legend-title">Estimated heat</span>
      <div className="heat-scale">
        <span className="heat-bar" style={{ background: HEAT_GRADIENT }} aria-hidden="true" />
        <span className="heat-ticks small">
          <span>None</span>
          <span>Low</span>
          <span>Medium</span>
          <span>High</span>
        </span>
      </div>
      <p className="legend-note">{HEAT_DISCLAIMER}</p>
    </div>
  );
}

interface Hot {
  meshId: string;
  name: string;
  v: number;
}

/** The hottest areas right now, left and right merged. */
function hottest(heat: Map<string, number>, n: number): Hot[] {
  const byArea = new Map<string, Hot>();
  for (const [meshId, v] of heat) {
    const info = meshIndex.get(meshId);
    if (!info || v < 0.05) continue;
    const key = `${info.kind}:${info.id}`;
    const name = (info.kind === 'region' ? regionById.get(info.id)?.name : networkById.get(info.id)?.name) ?? meshId;
    const cur = byArea.get(key);
    if (!cur || v > cur.v) byArea.set(key, { meshId, name, v });
  }
  return [...byArea.values()].sort((a, b) => b.v - a.v).slice(0, n);
}

export function HeatNow({ model, clock, networks, onWhy }: { model: HeatModel; clock: PlayClock; networks: boolean; onWhy: (meshId: string) => void }) {
  const read = () => {
    const t = clock.now();
    const mesh = model.meshHeat(t, new Map());
    // show the areas of the layer that is on screen
    for (const k of [...mesh.keys()]) if (k.includes('_yeo7_') !== networks) mesh.delete(k);
    return { t, sys: model.systemHeat(t), hot: hottest(mesh, 4) };
  };
  const [snap, setSnap] = useState(read);
  useEffect(() => {
    setSnap(read());
    const id = window.setInterval(() => setSnap(read()), 150);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, clock, networks]);

  return (
    <section className="card now-card" aria-label="Estimated heat right now">
      <div className="now-head">
        <h2>Right now</h2>
        <span className="mono now-time">{formatTime(snap.t)}</span>
      </div>
      <ul className="now-bars">
        {SYSTEMS.map((s, i) => {
          const v = snap.sys[i];
          return (
            <li key={s.id} data-system={s.id} data-heat={v.toFixed(2)}>
              <span className="now-label">{s.name}</span>
              <span className="now-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(v * 100)}%`, background: heatCSS(Math.max(0.25, v)) }} />
              </span>
              <span className="now-word">{heatWord(v)}</span>
            </li>
          );
        })}
      </ul>
      <h3 className="now-sub">Hottest areas</h3>
      {snap.hot.length === 0 ? (
        <p className="small muted">Nothing is heated at this moment: no detected input here has a research link.</p>
      ) : (
        <ul className="now-hot">
          {snap.hot.map((h) => (
            <li key={h.meshId}>
              <span className="swatch big" style={{ background: heatCSS(h.v) }} aria-hidden="true" />
              <span className="now-hot-name">{h.name}</span>
              <button type="button" className="btn small ghost" onClick={() => onWhy(h.meshId)}>
                Why?
              </button>
            </li>
          ))}
        </ul>
      )}
      <details className="how-est">
        <summary>How is this estimated?</summary>
        <p className="small">
          The app measures what's in the media moment by moment: loudness and punch, speech- and music-like sound, motion, faces, cuts and, with a transcript, words. Each brain
          area heats up in proportion to how much of the input it is linked to by published research, weighted by how strong and how direct that research is.
        </p>
        <p className="small">
          Areas without a research link never heat up. Real brainwaves (EEG) or brain scans can only come from sensors on a person; this is an estimate for exploring media. The
          Evidence view shows every link and source.
        </p>
      </details>
    </section>
  );
}

const PANEL = { bg: '#0d1218', grid: 'rgba(255,255,255,0.07)', label: '#aeb8c4', line: '#fbb125', play: '#ffe27a', future: 'rgba(13,18,24,0.6)' };

/** Scrolling traces for each brain system, like a monitor: past on the left, the playhead, then what's coming. */
export function Waves({ model, clock, onSeek }: { model: HeatModel; clock: PlayClock; onSeek: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hoverX = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; t: number; vals: number[] } | null>(null);
  const layout = useRef({ w: 0, h: 0, labelW: 104, span: 20 });

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    let raf = 0;
    let lastT = -1;
    let lastKey = '';
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const narrow = r.width < 520;
      layout.current = { w: r.width, h: r.height, labelW: narrow ? 74 : 104, span: narrow ? 12 : 20 };
      lastKey = '';
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();

    const draw = () => {
      const t = clock.now();
      const key = `${layout.current.w}x${layout.current.h}|${hoverX.current}`;
      if (Math.abs(t - lastT) > 1 / 120 || key !== lastKey) {
        lastT = t;
        lastKey = key;
        const { w, h, labelW, span } = layout.current;
        const axisH = 18;
        const rows = SYSTEMS.length;
        const rowH = (h - axisH) / rows;
        const plotW = w - labelW;
        const t0 = t - span * 0.75;
        const xOf = (tt: number) => labelW + ((tt - t0) / span) * plotW;
        ctx.fillStyle = PANEL.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${w < 520 ? 11 : 12}px 'Source Sans 3 Variable', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        for (let k = 0; k < rows; k++) {
          const top = k * rowH;
          const base = top + rowH - 3;
          const amp = rowH - 7;
          ctx.fillStyle = PANEL.label;
          ctx.fillText(SYSTEMS[k].name, 8, top + rowH / 2);
          ctx.strokeStyle = PANEL.grid;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(labelW, base + 0.5);
          ctx.lineTo(w, base + 0.5);
          ctx.stroke();
          const tr = model.traces[k];
          ctx.beginPath();
          let started = false;
          let firstX = 0;
          let lastX = 0;
          for (let x = labelW; x <= w; x += 2) {
            const tt = t0 + ((x - labelW) / plotW) * span;
            if (tt < 0 || tt > model.duration) continue;
            const v = tr[Math.min(tr.length - 1, Math.round(tt / model.step))];
            const y = base - v * amp;
            if (!started) {
              ctx.moveTo(x, y);
              firstX = x;
              started = true;
            } else ctx.lineTo(x, y);
            lastX = x;
          }
          if (started) {
            ctx.strokeStyle = PANEL.line;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.lineTo(lastX, base);
            ctx.lineTo(firstX, base);
            ctx.closePath();
            const g = ctx.createLinearGradient(0, top, 0, base);
            g.addColorStop(0, 'rgba(251,177,37,0.38)');
            g.addColorStop(1, 'rgba(192,40,45,0.05)');
            ctx.fillStyle = g;
            ctx.fill();
          }
        }
        // what hasn't played yet is dimmed
        const px = xOf(t);
        ctx.fillStyle = PANEL.future;
        ctx.fillRect(px, 0, w - px, h - axisH);
        ctx.strokeStyle = PANEL.play;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h - axisH);
        ctx.stroke();
        // time axis every 5 s
        ctx.fillStyle = PANEL.label;
        ctx.textBaseline = 'alphabetic';
        for (let s = Math.ceil(t0 / 5) * 5; s <= t0 + span; s += 5) {
          if (s < 0 || s > model.duration) continue;
          const x = xOf(s);
          ctx.fillRect(x, h - axisH, 1, 4);
          ctx.fillText(formatTime(s), x + 3, h - 4);
        }
        if (hoverX.current !== null && hoverX.current > labelW) {
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(hoverX.current + 0.5, 0);
          ctx.lineTo(hoverX.current + 0.5, h - axisH);
          ctx.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [model, clock]);

  const timeAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const { labelW, span } = layout.current;
    const x = clientX - r.left;
    if (x < labelW) return null;
    const t = clock.now() - span * 0.75 + ((x - labelW) / (r.width - labelW)) * span;
    return { x, t: Math.max(0, Math.min(model.duration, t)) };
  };

  return (
    <section className="card waves-card" aria-label="Brain systems over time">
      <div className="waves-head">
        <div>
          <h2>Brain systems over time</h2>
          <p className="small muted">Estimated from the media, not an EEG recording. Click a moment to jump there.</p>
        </div>
      </div>
      <div className="waves-wrap">
        <canvas
          ref={canvas}
          className="waves"
          role="img"
          aria-label={`Estimated heat over time for ${SYSTEMS.map((s) => s.name).join(', ')}.`}
          onPointerMove={(e) => {
            const p = timeAt(e.clientX);
            hoverX.current = p?.x ?? null;
            setTip(p ? { x: p.x, t: p.t, vals: model.systemHeat(p.t) } : null);
          }}
          onPointerLeave={() => {
            hoverX.current = null;
            setTip(null);
          }}
          onClick={(e) => {
            const p = timeAt(e.clientX);
            if (p) onSeek(p.t);
          }}
        />
        {tip && (
          <div className="waves-tip" style={{ left: Math.min(tip.x + 12, layout.current.w - 170) }}>
            <strong className="mono">{formatTime(tip.t)}</strong>
            {SYSTEMS.map((s, i) => (
              <span key={s.id}>
                {s.name}: {heatWord(tip.vals[i]).toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Play controls for analyses without a media file (the demo, transcript-only). */
export function VirtualPlayer({ clock, playing, time, duration, onSeek }: { clock: PlayClock; playing: boolean; time: number; duration: number; onSeek: (t: number) => void }) {
  return (
    <div className="vplayer">
      <button type="button" className="btn primary small" onClick={() => (playing ? clock.pause() : clock.play())}>
        {playing ? 'Pause' : 'Play'}
      </button>
      <input
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={Math.min(duration, time)}
        onChange={(e) => onSeek(+e.target.value)}
        aria-label="Position"
      />
      <span className="mono small">
        {formatTime(time)} / {formatTime(duration)}
      </span>
    </div>
  );
}
