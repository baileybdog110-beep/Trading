import { useEffect, useMemo, useRef, useState } from 'react';
import { db, regionById } from '../evidence/db';
import type { PlayClock } from '../heat/clock';
import {
  HUMAN_AGREEMENT,
  KEY_NAMES,
  NOT_ESTIMATED,
  SYSTEMS,
  contributions,
  emotionLabel,
  meshColours,
  modelInfo,
  inputPhrase,
  systemsAt,
  type EmotionLabel,
  type EmotionTimeline,
  type Liking,
  type SystemId,
} from '../emotion/model';
import type { HeatSource } from './BrainView';
import { formatTime } from './format';

type Timeline = EmotionTimeline & { note?: string };

export const EMOTION_DISCLAIMER =
  'The emotion is estimated from the sound (checked against real listeners) and, for video, the picture. Brain-system levels apply published studies to that estimate: they are not a recording of anyone’s brain or chemistry.';

export const LABEL_COLOR: Record<EmotionLabel['id'], string> = {
  joyful: '#f5b81c',
  energetic: '#f08c2e',
  tense: '#ef4444',
  uneasy: '#b4536b',
  sad: '#5b8def',
  subdued: '#7b8794',
  calm: '#2cb5a0',
  pleasant: '#8fc740',
  neutral: '#9aa3ad',
  silence: 'transparent',
};

const levelWord = (v: number) => (v >= 0.6 ? 'High' : v >= 0.3 ? 'Medium' : v > 0.08 ? 'Low' : 'Quiet');
const meshesOf = (region: string) => Object.values(regionById.get(region)?.meshes ?? {}) as string[];
const sourceById = new Map(db.sources.map((s) => [s.id, s]));
const idx = (tl: Timeline, t: number) => Math.max(0, Math.min(tl.valence.length - 1, Math.round(t / tl.step)));

/** The brain lit by system: each area takes the colour of the system(s) lighting it. */
export function useEmotionSource(tl: Timeline | undefined, clock: PlayClock, liking: Liking): HeatSource | null {
  const likingRef = useRef(liking);
  likingRef.current = liking;
  return useMemo(() => {
    if (!tl) return null;
    const colours = new Map<string, { v: number; rgb: [number, number, number] }>();
    const lastTint = new Map<string, [number, number, number]>();
    const who = new Map<string, SystemId[]>();
    return {
      inside: true,
      now: clock.now,
      playing: clock.playing,
      at(t, out) {
        out.clear();
        const state = systemsAt(tl, idx(tl, t), likingRef.current);
        meshColours(state, meshesOf, colours);
        who.clear();
        for (const p of state.parts) if (p.value > 0.05) for (const m of meshesOf(p.region)) who.set(m, [...(who.get(m) ?? []), p.system]);
        for (const [m, c] of colours) {
          out.set(m, c.v);
          lastTint.set(m, c.rgb);
        }
        return out;
      },
      tint: (m) => lastTint.get(m),
      describe(m, v) {
        const sys = [...new Set(who.get(m) ?? [])].map((id) => SYSTEMS.find((s) => s.id === id)!.name.toLowerCase());
        return sys.length && v > 0.05 ? `${levelWord(v).toLowerCase()} · ${sys.join(' + ')}` : 'not lit right now';
      },
    };
  }, [tl, clock]);
}

/** Re-render a few times a second while playing (and on seek). */
function useNow(clock: PlayClock, ms = 150) {
  const [t, setT] = useState(clock.now());
  useEffect(() => {
    setT(clock.now());
    const id = window.setInterval(() => setT(clock.now()), ms);
    return () => window.clearInterval(id);
  }, [clock, ms]);
  return t;
}

export function EmotionLegend() {
  return (
    <div className="legend emo-legend" aria-label="Colour key">
      <span className="legend-title">Brain systems</span>
      <ul className="emo-keys">
        {SYSTEMS.filter((s) => s.regions.length).map((s) => (
          <li key={s.id}>
            <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
            {s.name}
          </li>
        ))}
      </ul>
      <p className="legend-note">{EMOTION_DISCLAIMER}</p>
    </div>
  );
}

/** Russell's circumplex with the current estimate, its typical error, and the last few seconds as a trail. */
function Circumplex({ tl, i }: { tl: Timeline; i: number }) {
  const info = modelInfo(tl.model === 'none' ? 'cues' : tl.model)!;
  const S = 120;
  const R = 0.6; // raters' scale shown: -0.6..0.6 fills the plot
  const x = (v: number) => S / 2 + (Math.max(-R, Math.min(R, v)) / R) * (S / 2 - 6);
  const y = (a: number) => S / 2 - (Math.max(-R, Math.min(R, a)) / R) * (S / 2 - 6);
  const trail: string[] = [];
  for (let k = Math.max(0, i - Math.round(8 / tl.step)); k <= i; k++) if (!tl.silent[k]) trail.push(`${x(tl.valence[k]).toFixed(1)},${y(tl.arousal[k]).toFixed(1)}`);
  const lab = emotionLabel(tl.valence[i], tl.arousal[i], tl.silent[i]);
  const rx = (info.rmse.valence / R) * (S / 2 - 6);
  const ry = (info.rmse.arousal / R) * (S / 2 - 6);
  return (
    <svg className="circumplex" viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Estimate: ${lab.name}`}>
      <rect x="0.5" y="0.5" width={S - 1} height={S - 1} rx="10" className="cx-bg" />
      <line x1={S / 2} y1="6" x2={S / 2} y2={S - 6} className="cx-axis" />
      <line x1="6" y1={S / 2} x2={S - 6} y2={S / 2} className="cx-axis" />
      <text x={S - 8} y={S / 2 - 4} className="cx-tick" textAnchor="end">
        pleasant
      </text>
      <text x="8" y={S / 2 - 4} className="cx-tick">
        unpleasant
      </text>
      <text x={S / 2 + 4} y="14" className="cx-tick">
        energetic
      </text>
      <text x={S / 2 + 4} y={S - 8} className="cx-tick">
        calm
      </text>
      {trail.length > 1 && <polyline points={trail.join(' ')} className="cx-trail" />}
      {!tl.silent[i] && (
        <>
          <ellipse cx={x(tl.valence[i])} cy={y(tl.arousal[i])} rx={rx} ry={ry} className="cx-err" />
          <circle cx={x(tl.valence[i])} cy={y(tl.arousal[i])} r="5.5" fill={LABEL_COLOR[lab.id]} className="cx-dot" />
        </>
      )}
      {tl.audio && tl.visual && !tl.silent[i] && (
        <>
          <circle cx={x(tl.audio.valence[i])} cy={y(tl.audio.arousal[i])} r="3" className="cx-part" />
          <circle cx={x(tl.visual.valence[i])} cy={y(tl.visual.arousal[i])} r="3" className="cx-part cx-pic" />
        </>
      )}
    </svg>
  );
}

function Why({ tl, i }: { tl: Timeline; i: number }) {
  if (tl.model === 'none' || tl.silent[i]) return null;
  const pick = (dim: 'valence' | 'arousal') =>
    contributions(tl, i, dim)
      .filter((c) => Math.abs(c.value) > 0.015)
      .slice(0, 2);
  const rows = [
    ...pick('arousal').map((c) => ({ key: `a${c.name}`, text: `${c.value > 0 ? 'More' : 'Less'} energetic: ${inputPhrase(c)}` })),
    ...pick('valence').map((c) => ({ key: `v${c.name}`, text: `${c.value > 0 ? 'More' : 'Less'} pleasant: ${inputPhrase(c)}` })),
  ];
  return (
    <ul className="emo-why small" aria-label="Main reasons">
      {rows.map((r) => (
        <li key={r.key}>{r.text}</li>
      ))}
    </ul>
  );
}

export function EmotionNow({ tl, clock }: { tl: Timeline; clock: PlayClock }) {
  const t = useNow(clock);
  const i = idx(tl, t);
  const lab = emotionLabel(tl.valence[i], tl.arousal[i], tl.silent[i]);
  const face = tl.visual?.face[i];
  const bpm = tl.bpm[i];
  return (
    <section className="card emo-now" aria-label="Emotion right now" data-emotion={lab.id}>
      <div className="now-head">
        <h2>Emotion right now</h2>
        <span className="mono now-time">{formatTime(t)}</span>
      </div>
      <div className="emo-now-body">
        <Circumplex tl={tl} i={i} />
        <div className="emo-now-text">
          <p className="emo-label">
            <span className="emo-dot" style={{ background: LABEL_COLOR[lab.id] }} aria-hidden="true" />
            {lab.name}
          </p>
          <p className="small muted">{lab.hint}</p>
          <Why tl={tl} i={i} />
          <p className="small muted emo-facts">
            {bpm > 0 && !tl.silent[i] ? `~${Math.round(bpm)} BPM · ` : ''}
            {tl.key ? `key ${KEY_NAMES[tl.key.tonic]} ${tl.key.major ? 'major' : 'minor'} (whole track)` : ''}
          </p>
          {face && face.p > 0.4 && <p className="small">On screen: a face that looks {face.expr === 'neutral' ? 'neutral' : face.expr}</p>}
        </div>
      </div>
      {tl.audio && tl.visual && (
        <p className="small muted cx-key">
          <span className="cx-k" /> sound <span className="cx-k cx-k-pic" /> picture - the big dot combines them.
        </p>
      )}
      <Accuracy tl={tl} />
    </section>
  );
}

function Accuracy({ tl }: { tl: Timeline }) {
  const info = modelInfo(tl.model === 'none' ? 'cues' : tl.model)!;
  const h = HUMAN_AGREEMENT;
  const pc = (r: number) => r.toFixed(2);
  return (
    <details className="how-est">
      <summary>How accurate is this?</summary>
      {tl.model === 'none' ? (
        <p className="small">This file has no sound, so the estimate comes from the picture only (colour, motion, cuts and faces). Those rules come from research but could not be checked against viewer ratings here.</p>
      ) : (
        <>
          <p className="small">
            The sound model was checked against real listeners: 95 pieces rated bar by bar by about 30 people each (VGMIDI). On pieces it had never seen, its estimate matched the
            average listener at <strong>r = {pc(info.valence.r)}</strong> for pleasantness and <strong>r = {pc(info.arousal.r)}</strong> for energy (1 = perfect). One person
            matches the average of the others at r = {pc(h.valence.oneListenerVsOthers_r)} and {pc(h.arousal.oneListenerVsOthers_r)} - so the estimate is about as close to the
            crowd as a typical listener is.
          </p>
          <p className="small">
            Following changes <em>within</em> a song is harder (median r = {pc(info.valence.withinR_median ?? 0)} and {pc(info.arousal.withinR_median ?? 0)} per piece). The rated
            pieces are solo-piano game music, so other styles are less certain. The dot's shaded area shows the typical error.
          </p>
          {tl.model === 'cues' && <p className="small">The music mood tagger did not run for this file, so a slightly less accurate cue-only model was used.</p>}
          {tl.visual && <p className="small">Picture cues (colour, motion, cuts, faces) follow published research but were not checked against ratings; they count half as much as the sound.</p>}
        </>
      )}
      {tl.note && <p className="small muted">{tl.note}</p>}
    </details>
  );
}

const CHEM_SHORT: Record<SystemId, string> = {
  reward: 'Dopamine & opioids',
  stress: 'Cortisol & adrenaline',
  sadness: 'No single chemical',
  calm: 'Heart rate & breathing',
};

export function ChemistryPanel({
  tl,
  clock,
  liking,
  onLiking,
  onFocusRegion,
}: {
  tl: Timeline;
  clock: PlayClock;
  liking: Liking;
  onLiking: (l: Liking) => void;
  onFocusRegion: (meshId: string) => void;
}) {
  const t = useNow(clock);
  const i = idx(tl, t);
  const state = systemsAt(tl, i, liking);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="card chem-card" aria-label="Brain chemistry right now">
      <h2>Brain systems right now</h2>
      <div className="liking">
        <span className="small">Do you like this {tl.visual ? 'video' : 'music'}?</span>
        <div className="seg-control" role="radiogroup" aria-label="Do you like it?">
          {(
            [
              ['yes', 'Yes'],
              ['unsure', 'Not sure'],
              ['no', 'No'],
            ] as [Liking, string][]
          ).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={liking === k} className={liking === k ? 'is-on' : ''} onClick={() => onLiking(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted liking-note">Pleasure and dopamine depend on the listener: the reward system only responds strongly in people who enjoy the music.</p>
      <ul className="chem-list">
        {SYSTEMS.map((s) => {
          const v = state.level[s.id];
          const isOpen = open === s.id;
          return (
            <li key={s.id} className={`chem ${isOpen ? 'is-open' : ''}`} data-system={s.id} data-level={v.toFixed(2)}>
              <button type="button" className="chem-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                <span className="swatch big" style={{ background: s.color }} aria-hidden="true" />
                <span className="chem-name">
                  <strong>{s.name}</strong>
                  <span className="small muted">{CHEM_SHORT[s.id as SystemId]}</span>
                </span>
                <span className="now-bar" aria-hidden="true">
                  <span style={{ width: `${Math.round(v * 100)}%`, background: s.color }} />
                </span>
                <span className="now-word">{levelWord(v)}</span>
              </button>
              {isOpen && (
                <div className="chem-detail small">
                  <p>{s.summary}</p>
                  <p className="muted">
                    <strong>Chemistry:</strong> {s.chemicals}. <strong>Evidence:</strong> {s.grade}.
                  </p>
                  <p className="chem-sub">What drives it here</p>
                  <ul>
                    {s.drivers.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                  {s.regions.length > 0 && (
                    <>
                      <p className="chem-sub">Areas lit</p>
                      <ul>
                        {s.regions.map((r) => (
                          <li key={r.region}>
                            <button type="button" className="linklike" onClick={() => onFocusRegion(meshesOf(r.region)[0])}>
                              {regionById.get(r.region)?.name ?? r.region}
                            </button>
                            : {r.role}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  <p className="chem-sub">Studies</p>
                  <ul className="chem-studies">
                    {s.evidence.map((e) => {
                      const src = sourceById.get(e.source);
                      return (
                        <li key={e.source}>
                          {e.says}{' '}
                          {src && (
                            <a href={src.url} target="_blank" rel="noreferrer">
                              {src.shortCite}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {s.caveats.map((c) => (
                    <p key={c} className="muted">
                      {c}
                    </p>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {NOT_ESTIMATED.map((n) => {
          const isOpen = open === n.id;
          return (
            <li key={n.id} className={`chem chem-none ${isOpen ? 'is-open' : ''}`} data-system={n.id}>
              <button type="button" className="chem-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : n.id)}>
                <span className="swatch big swatch-none" aria-hidden="true" />
                <span className="chem-name">
                  <strong>{n.name}</strong>
                  <span className="small muted">Not estimated</span>
                </span>
                <span className="now-word chem-na">No brain evidence</span>
              </button>
              {isOpen && (
                <div className="chem-detail small">
                  <p>{n.summary}</p>
                  <p className="muted">{n.detail}</p>
                  <ul className="chem-studies">
                    {n.sources.map((id) => {
                      const src = sourceById.get(id);
                      return src ? (
                        <li key={id}>
                          <a href={src.url} target="_blank" rel="noreferrer">
                            {src.shortCite}
                          </a>
                          : {src.keyFindings[0]}
                        </li>
                      ) : null;
                    })}
                  </ul>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PANEL = { bg: '#0d1218', grid: 'rgba(255,255,255,0.08)', label: '#aeb8c4', play: '#ffffff', future: 'rgba(13,18,24,0.35)' };
const LANES: { id: SystemId; name: string }[] = [
  { id: 'reward', name: 'Reward' },
  { id: 'stress', name: 'Stress' },
  { id: 'sadness', name: 'Sadness' },
  { id: 'calm', name: 'Calm' },
];

/** The whole track at a glance: emotion colour strip, energy and pleasantness curves, system lanes and events. */
export function EmotionTrack({ tl, clock, liking, duration, onSeek }: { tl: Timeline; clock: PlayClock; liking: Liking; duration: number; onSeek: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hoverX = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; t: number } | null>(null);
  const layout = useRef({ w: 0, h: 0, labelW: 92 });
  const levels = useMemo(() => {
    const out: Record<SystemId, number[]> = { reward: [], stress: [], sadness: [], calm: [] };
    for (let i = 0; i < tl.valence.length; i++) {
      const s = systemsAt(tl, i, liking);
      for (const l of LANES) out[l.id].push(s.level[l.id]);
    }
    return out;
  }, [tl, liking]);

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
      layout.current = { w: r.width, h: r.height, labelW: r.width < 520 ? 66 : 92 };
      lastKey = '';
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();
    const draw = () => {
      const t = clock.now();
      const key = `${layout.current.w}x${layout.current.h}|${hoverX.current}`;
      if (Math.abs(t - lastT) > 1 / 60 || key !== lastKey) {
        lastT = t;
        lastKey = key;
        const { w, h, labelW } = layout.current;
        const axisH = 16;
        const plotW = w - labelW - 6;
        const xOf = (tt: number) => labelW + (tt / Math.max(0.1, duration)) * plotW;
        const n = tl.valence.length;
        ctx.fillStyle = PANEL.bg;
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${w < 520 ? 11 : 12}px 'Source Sans 3 Variable', system-ui, sans-serif`;
        ctx.textBaseline = 'middle';
        // rows: emotion strip, curves, 4 system lanes
        const stripH = 16;
        const curveH = (h - axisH - stripH) * 0.36;
        const laneH = (h - axisH - stripH - curveH) / LANES.length;
        // emotion strip
        ctx.fillStyle = PANEL.label;
        ctx.fillText('Emotion', 8, stripH / 2 + 1);
        for (let i = 0; i < n; i++) {
          const lab = emotionLabel(tl.valence[i], tl.arousal[i], tl.silent[i]);
          if (lab.id === 'silence') continue;
          ctx.fillStyle = LABEL_COLOR[lab.id];
          const x0 = xOf(i * tl.step - tl.step / 2);
          ctx.fillRect(x0, 2, Math.max(1, xOf((i + 1) * tl.step - tl.step / 2) - x0 + 0.5), stripH - 4);
        }
        // curves: energy (arousal) and pleasantness (valence), -0.6..0.6
        const cTop = stripH;
        const cMid = cTop + curveH / 2;
        ctx.strokeStyle = PANEL.grid;
        ctx.beginPath();
        ctx.moveTo(labelW, cMid + 0.5);
        ctx.lineTo(w, cMid + 0.5);
        ctx.stroke();
        ctx.fillStyle = PANEL.label;
        ctx.fillText('Energy', 8, cTop + curveH * 0.3);
        ctx.fillStyle = '#8fd3ff';
        ctx.fillText('Pleasant', 8, cTop + curveH * 0.72);
        const curve = (vals: number[], color: string) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          let pen = false;
          for (let i = 0; i < n; i++) {
            if (tl.silent[i]) {
              pen = false;
              continue;
            }
            const y = cMid - (Math.max(-0.6, Math.min(0.6, vals[i])) / 0.6) * (curveH / 2 - 3);
            if (!pen) ctx.moveTo(xOf(i * tl.step), y);
            else ctx.lineTo(xOf(i * tl.step), y);
            pen = true;
          }
          ctx.stroke();
        };
        curve(tl.arousal, '#f2f4f7');
        curve(tl.valence, '#8fd3ff');
        // system lanes
        LANES.forEach((l, k) => {
          const top = cTop + curveH + k * laneH;
          const base = top + laneH - 2;
          const amp = laneH - 5;
          const color = SYSTEMS.find((s) => s.id === l.id)!.color;
          ctx.fillStyle = PANEL.label;
          ctx.fillText(l.name, 8, top + laneH / 2);
          ctx.strokeStyle = PANEL.grid;
          ctx.beginPath();
          ctx.moveTo(labelW, base + 0.5);
          ctx.lineTo(w, base + 0.5);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(xOf(0), base);
          const vals = levels[l.id];
          for (let i = 0; i < n; i++) ctx.lineTo(xOf(i * tl.step), base - vals[i] * amp);
          ctx.lineTo(xOf((n - 1) * tl.step), base);
          ctx.closePath();
          ctx.globalAlpha = 0.75;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = 1;
        });
        // events: peaks and build-ups on the reward lane
        const rTop = cTop + curveH;
        for (const e of tl.events) {
          if (e.kind === 'hit') continue;
          const x = xOf(e.t);
          ctx.fillStyle = e.kind === 'peak' ? '#ffffff' : 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          if (e.kind === 'peak') {
            ctx.moveTo(x, rTop + 2);
            ctx.lineTo(x - 4, rTop + 9);
            ctx.lineTo(x + 4, rTop + 9);
          } else {
            ctx.moveTo(x - 4, rTop + 9);
            ctx.lineTo(x + 4, rTop + 2);
            ctx.lineTo(x + 4, rTop + 9);
          }
          ctx.closePath();
          ctx.fill();
        }
        // playhead; the part not yet played is dimmed slightly
        const px = xOf(Math.min(duration, t));
        ctx.fillStyle = PANEL.future;
        ctx.fillRect(px, 0, w - px, h - axisH);
        ctx.strokeStyle = PANEL.play;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, h - axisH);
        ctx.stroke();
        // time axis
        ctx.fillStyle = PANEL.label;
        ctx.textBaseline = 'alphabetic';
        const every = duration > 600 ? 60 : duration > 180 ? 30 : duration > 60 ? 10 : 5;
        for (let s = 0; s <= duration; s += every) {
          const x = xOf(s);
          ctx.fillRect(x, h - axisH, 1, 4);
          ctx.fillText(formatTime(s), x + 3, h - 3);
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
  }, [tl, clock, levels, duration]);

  const timeAt = (clientX: number) => {
    const r = canvas.current!.getBoundingClientRect();
    const { labelW } = layout.current;
    const x = clientX - r.left;
    if (x < labelW) return null;
    return { x, t: Math.max(0, Math.min(duration, ((x - labelW) / (r.width - labelW - 6)) * duration)) };
  };
  const ti = tip ? idx(tl, tip.t) : 0;
  const tipLab = tip ? emotionLabel(tl.valence[ti], tl.arousal[ti], tl.silent[ti]) : null;
  const peaks = tl.events.filter((e) => e.kind === 'peak').length;
  const builds = tl.events.filter((e) => e.kind === 'buildup').length;
  return (
    <section className="card waves-card emo-track-card" aria-label="Emotion over the whole track">
      <div className="waves-head">
        <div>
          <h2>Emotion over the whole track</h2>
          <p className="small muted">
            Colour = estimated emotion. ▲ peak ({peaks}) and ◢ build-up ({builds}): the moments linked to chills and dopamine release. Click to jump.
          </p>
        </div>
      </div>
      <div className="waves-wrap">
        <canvas
          ref={canvas}
          className="waves emo-track"
          role="img"
          aria-label="Estimated emotion, energy, pleasantness and brain-system levels across the whole track."
          onPointerMove={(e) => {
            const p = timeAt(e.clientX);
            hoverX.current = p?.x ?? null;
            setTip(p);
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
        {tip && tipLab && (
          <div className="waves-tip" style={{ left: Math.min(tip.x + 12, layout.current.w - 190) }}>
            <strong className="mono">{formatTime(tip.t)}</strong>
            <span>{tipLab.name}</span>
            {LANES.map((l) => (
              <span key={l.id}>
                {l.name}: {levelWord(levels[l.id][ti]).toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Demo song buttons for the landing page. */
export function DemoSongs({ songs, busy, onPick }: { songs: { id: string; title: string; artist: string; character: string; licence: string; source: string }[]; busy: boolean; onPick: (id: string) => void }) {
  return (
    <div className="demo-songs">
      <p className="small muted">Or try a real song (analysed live on this device):</p>
      <ul>
        {songs.map((s) => (
          <li key={s.id}>
            <button type="button" className="btn small" disabled={busy} onClick={() => onPick(s.id)}>
              {s.title}
            </button>
            <span className="small muted">
              {s.character} ·{' '}
              <a href={s.source} target="_blank" rel="noreferrer">
                {s.artist}
              </a>
              , {s.licence}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
