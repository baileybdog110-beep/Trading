import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runAnalysis, runTranscriptOnly, withTranscript, type Progress, type RawAnalyses } from './analysis/run';
import { parseTranscript } from './analysis/transcript/parse';
import { transcribeLocally, type AsrModelKey } from './analysis/transcript/asr';
import { suggestInterpretations, suggestionToFeature } from './analysis/transcript/llm';
import { demoSession } from './demo/demoSession';
import { db } from './evidence/db';
import type { FeatureId } from './evidence/types';
import { DEFAULT_CONTEXT, bestGrade, mapSegment, type MeshResult } from './pipeline/mapping';
import { applyOverrides, confirmFeature, rejectFeature, type Overrides } from './pipeline/overrides';
import type { AnalysisSession, ListenerContext, Segment, TranscriptCue } from './pipeline/types';
import { AboutModal } from './ui/AboutModal';
import { BrainView, type ViewMode } from './ui/BrainView';
import { currentTheme } from './ui/colors';
import { EvidenceBrowser } from './ui/EvidenceBrowser';
import { AsrDialog, LlmDialog } from './ui/ExternalDialogs';
import { FeaturePanel } from './ui/FeaturePanel';
import { HighlightedPanel } from './ui/HighlightedPanel';
import { formatTime } from './ui/format';
import { Legend, ListenerContextCard } from './ui/Legend';
import { MediaActions, MediaPanel, TranscriptPanel } from './ui/MediaPanel';
import { ReasoningPanel } from './ui/ReasoningPanel';
import { RegionPanel } from './ui/RegionPanel';
import { Timeline } from './ui/Timeline';
import { usePlayClock } from './heat/clock';
import { buildHeatModel } from './heat/model';
import { HeatLegend, HeatNow, VirtualPlayer, Waves } from './ui/HeatViews';
import type { HeatSource } from './ui/BrainView';
import { UploadPanel } from './ui/UploadPanel';
import { ChemistryPanel, DemoSongs, EmotionLegend, EmotionNow, EmotionTrack, useEmotionSource } from './ui/EmotionViews';
import { DEMO_SONGS, loadDemoSong } from './demo/songs';
import type { Liking } from './emotion/model';
import { HOSTED, HOSTED_NETWORK_NOTE } from './util/hosted';

type RightTab = 'highlighted' | 'reasoning' | 'features';
type View = 'emotion' | 'heat' | 'research';

export default function App() {
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const mediaFile = useRef<File | null>(null);
  const raw = useRef<RawAnalyses | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [ctx, setCtx] = useState<ListenerContext>(DEFAULT_CONTEXT);
  const [segId, setSegId] = useState<string | null>(null);
  const [mesh, setMesh] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('anatomy');
  const [tab, setTab] = useState<RightTab>('highlighted');
  const [view, setView] = useState<View>('heat');
  const [liking, setLiking] = useState<Liking>('unsure');
  const [time, setTime] = useState(0);
  const [follow, setFollow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'about' | 'evidence' | 'asr' | 'llm' | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(currentTheme());
  const abort = useRef<AbortController | null>(null);
  const player = useRef<HTMLMediaElement>(null);
  const rightCol = useRef<HTMLElement>(null);
  const brainCol = useRef<HTMLElement>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(currentTheme());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const segments = useMemo(() => (session ? applyOverrides(session.segments, overrides) : []), [session, overrides]);
  // bring the map into view when a new session starts (matters on phones, where columns stack)
  useEffect(() => {
    if (session) window.scrollTo({ top: 0 });
  }, [session?.id]);
  const segment: Segment | undefined = segments.find((s) => s.id === segId) ?? segments[0];
  // cues that straddle a boundary appear in two segments; list each once
  const allCues = useMemo(() => [...new Set(segments.flatMap((s) => s.cues))], [segments]);
  const segMap = useMemo(() => (segment ? mapSegment(db, segment, ctx) : null), [segment, ctx]);
  const empty = useMemo(() => new Map(), []);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => setFocus(null), [segment?.id]);
  // Optionally restrict the map to a single association so its regions can be seen alone.
  const shown = useMemo(() => {
    if (!segMap) return empty;
    if (!focus) return segMap.meshes;
    const out = new Map<string, MeshResult>();
    for (const [k, r] of segMap.meshes) {
      const hits = r.hits.filter((h) => h.association.id === focus);
      if (hits.length) out.set(k, { ...r, hits, grade: bestGrade(hits.map((h) => h.association.grade)) });
    }
    return out;
  }, [segMap, focus, empty]);

  const selectSegment = useCallback((s: Segment) => {
    setSegId(s.id);
  }, []);

  const onTime = useCallback(
    (t: number) => {
      setTime(t);
      if (!follow) return;
      const s = segments.find((x) => t >= x.start && t < x.end);
      if (s && s.id !== segId) setSegId(s.id);
    },
    [follow, segments, segId],
  );

  const hasMedia = !!mediaUrl && !!session && session.mediaKind !== 'none';
  const { clock, isPlaying } = usePlayClock(player, hasMedia, session?.duration ?? 0, onTime);

  const seek = useCallback(
    (t: number) => {
      setTime(t);
      clock.seek(t);
      const s = segments.find((x) => t >= x.start && t < x.end);
      if (s) setSegId(s.id);
    },
    [segments, clock],
  );

  // The estimated heat map: rebuilt when features, corrections or listener answers change.
  const heatModel = useMemo(
    () => (session ? buildHeatModel(db, segments, session.tracks, allCues, ctx, session.duration) : null),
    [session, segments, allCues, ctx],
  );
  const heatSource = useMemo<HeatSource | null>(() => {
    if (view !== 'heat') return null;
    if (!heatModel) return { now: () => 0, playing: () => false, at: (_t, out) => (out.clear(), out) };
    return { now: clock.now, playing: clock.playing, at: heatModel.meshHeat };
  }, [view, heatModel, clock]);

  const emotionSource = useEmotionSource(view === 'emotion' ? session?.emotion : undefined, clock, liking);
  const chemCol = useRef<HTMLDivElement>(null);

  const reset = () => {
    abort.current?.abort();
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    setMediaUrl(null);
    mediaFile.current = null;
    raw.current = null;
    setSession(null);
    setOverrides({});
    setSegId(null);
    setMesh(null);
    setTime(0);
    setProgress(null);
    setError(null);
    setTab('highlighted');
    setView('heat');
  };

  const loadTranscript = async (f: File | null): Promise<{ cues: TranscriptCue[]; timed: boolean; untimed?: string }> => {
    if (!f) return { cues: [], timed: false };
    const parsed = parseTranscript(f.name, await f.text());
    return { cues: parsed.cues, timed: parsed.timed, untimed: parsed.timed ? undefined : parsed.text };
  };

  const analyze = async (file: File, transcript: File | null, opts: { faces: boolean }) => {
    reset();
    setBusy(true);
    const url = URL.createObjectURL(file);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const t = await loadTranscript(transcript);
      const result = await runAnalysis(file, url, {
        faces: opts.faces,
        cues: t.cues,
        transcriptTimed: t.timed,
        untimedTranscript: t.untimed,
        onProgress: setProgress,
        signal: ac.signal,
      });
      mediaFile.current = file;
      raw.current = result.raw;
      setMediaUrl(url);
      setSession(result.session);
      setSegId(result.session.segments[0]?.id ?? null);
      setView(result.session.emotion ? 'emotion' : 'heat');
      setNotice(result.session.notes.join(' ') || null);
    } catch (e) {
      URL.revokeObjectURL(url);
      setError((e as Error).name === 'AbortError' ? 'Analysis cancelled. Nothing was kept.' : `Analysis failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const transcriptOnly = async (f: File) => {
    reset();
    const t = await loadTranscript(f);
    if (!t.timed) {
      setError('This transcript has no timestamps, so it cannot be placed on a timeline. Use SRT, VTT or timestamped JSON.');
      return;
    }
    const s = runTranscriptOnly(f.name, t.cues);
    setSession(s);
    setSegId(s.segments[0]?.id ?? null);
    setNotice(s.notes.join(' '));
  };

  const demoSong = async (id: string) => {
    const song = DEMO_SONGS.find((s) => s.id === id);
    if (!song) return;
    try {
      await analyze(await loadDemoSong(song), null, { faces: false });
    } catch (e) {
      setError(`Could not load the demo song: ${(e as Error).message}`);
    }
  };

  const demo = () => {
    reset();
    const s = demoSession();
    setSession(s);
    setSegId(s.segments[0].id);
    setNotice(null);
  };

  const exportPayload = () => {
    if (!session) return null;
    return {
      note: 'Research-based stimulus association map export. Contains detected features, your corrections and the evidence mappings - not brain measurements. No media is included.',
      evidenceDbVersion: db.meta.version,
      exportedAt: new Date().toISOString(),
      listenerContext: ctx,
      session: { ...session, segments },
      mappings: segments.map((s) => {
        const m = mapSegment(db, s, ctx);
        return {
          segment: s.id,
          start: s.start,
          end: s.end,
          regions: [...m.meshes.values()].map((r) => ({ mesh: r.meshId, grade: r.grade, associations: [...new Set(r.hits.map((h) => h.association.id))] })),
          processes: m.steps.map((st) => ({ rule: st.rule.id, outcome: st.outcome.kind, associations: st.associations.map((a) => a.id), unsupported: st.unsupported.map((u) => u.id) })),
        };
      }),
    };
  };

  const editFeature = (id: FeatureId, action: 'confirm' | 'reject' | 'reset') => {
    if (!segment || !session) return;
    const original = session.segments.find((s) => s.id === segment.id)?.features[id];
    setOverrides((o) => {
      const cur = { ...(o[segment.id] ?? {}) };
      if (action === 'reset') delete cur[id];
      else cur[id] = action === 'confirm' ? confirmFeature(original, id) : rejectFeature(original, id);
      return { ...o, [segment.id]: cur };
    });
  };

  const startAsr = async (model: AsrModelKey) => {
    setDialog(null);
    if (!session || !mediaFile.current || !raw.current) return;
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const cues = await transcribeLocally(mediaFile.current, model, {
        duration: session.duration,
        signal: ac.signal,
        onProgress: (note, fraction) => setProgress({ stage: 'audio', fraction, note }),
      });
      setSession(withTranscript(session, raw.current, cues, 'local-asr'));
      setOverrides({});
      setNotice(`Local speech recognition produced ${cues.length} cues. Segments were rebuilt, so earlier corrections were cleared. Please review the transcript for errors.`);
    } catch (e) {
      setError(`Speech recognition did not complete: ${(e as Error).message}. The rest of the analysis is unchanged.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const startLlm = async (key: string) => {
    setDialog(null);
    if (!session) return;
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const sugg = await suggestInterpretations(key, segments, (note) => setProgress({ stage: 'assemble', fraction: 0.5, note }), ac.signal);
      setSession({
        ...session,
        segments: session.segments.map((s) => {
          const mine = sugg.filter((x) => x.segmentId === s.id);
          if (!mine.length) return s;
          const features = { ...s.features };
          for (const m of mine) if (!features[m.label]?.present) features[m.label] = suggestionToFeature(m);
          return { ...s, features };
        }),
      });
      setNotice(`${sugg.length} interpretation suggestion(s) added as "needs review". They do not change the map until you confirm them in the Features tab.`);
    } catch (e) {
      setError(`Suggestions failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const selectMesh = (id: string | null) => {
    setMesh(id);
    if (id) {
      setTab('highlighted');
      if (id.includes('_yeo7_') && mode !== 'networks') setMode('networks');
      else if (!id.includes('_yeo7_') && mode === 'networks' && /^(L|R)_/.test(id)) {
        const cortical = db.regions.find((r) => Object.values(r.meshes).includes(id))?.kind === 'cortical';
        if (cortical) setMode('anatomy');
      }
    }
  };

  // Opening details from the list: start at the top of the panel (it scrolls on its own on desktop,
  // and sits below the brain on phones).
  const [focusReq, setFocusReq] = useState<{ meshId: string; seq: number } | null>(null);
  const openDetails = (id: string) => {
    selectMesh(id);
    setFocusReq((f) => ({ meshId: id, seq: (f?.seq ?? 0) + 1 }));
    requestAnimationFrame(() => {
      const el = rightCol.current;
      if (!el) return;
      el.scrollTop = 0;
      if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
    });
  };
  const why = (meshId: string) => {
    setView('research');
    openDetails(meshId);
  };
  const segIndex = segment ? segments.indexOf(segment) : -1;
  const goSegment = (i: number) => {
    const s = segments[i];
    if (s) {
      seek(s.start);
      selectSegment(s);
    }
  };

  const overridden = new Set(Object.keys((segment && overrides[segment.id]) ?? {}) as FeatureId[]);
  const hasTimedText = segments.some((s) => s.cues.length);

  return (
    <div className={`app ${session ? 'has-session' : 'landing'}`}>
      <header className="app-header">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="8" className="bm-bg" />
            <rect x="7" y="16" width="4.5" height="9" rx="1.5" className="bm-low" />
            <rect x="13.75" y="11" width="4.5" height="14" rx="1.5" className="bm-mid" />
            <rect x="20.5" y="6" width="4.5" height="19" rx="1.5" className="bm-high" />
          </svg>
          <div>
            <h1>Brain Heat Map</h1>
            <p className="tagline">
              Play a song or video and see the emotion it carries moment by moment, and the brain systems research links to it: reward (dopamine), stress and more. An estimate
              from published studies and real listener ratings, not a brain recording.
            </p>
          </div>
        </div>
        <nav className="header-actions" aria-label="Help and evidence">
          <button type="button" className="btn ghost small" onClick={() => setDialog('about')}>
            How to read this map
          </button>
          <button type="button" className="btn ghost small" onClick={() => setDialog('evidence')}>
            Evidence database
          </button>
        </nav>
      </header>

      {session?.isDemo && (
        <p className="demo-note" role="note">
          <strong>Demo data.</strong> Hand-authored features for a fictional video essay; no media was analysed.
        </p>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}
      {error && session && (
        <div className="notice error" role="alert">
          {error}
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <main className={`layout ${session ? `has-session view-${view} media-${session.mediaKind}` : 'landing'}`}>
        <div className="col-main">
          <section className="card brain-card" aria-label="Brain map" ref={brainCol}>
            <div className="map-head">
              {session ? (
                <div className="seg-control mode-switch" role="radiogroup" aria-label="What the brain shows">
                  {session.emotion && (
                    <button type="button" role="radio" aria-checked={view === 'emotion'} className={view === 'emotion' ? 'is-on' : ''} onClick={() => setView('emotion')}>
                      Emotion
                    </button>
                  )}
                  <button type="button" role="radio" aria-checked={view === 'heat'} className={view === 'heat' ? 'is-on' : ''} onClick={() => setView('heat')}>
                    Heat map
                  </button>
                  <button type="button" role="radio" aria-checked={view === 'research'} className={view === 'research' ? 'is-on' : ''} onClick={() => setView('research')}>
                    Evidence
                  </button>
                </div>
              ) : (
                <div className="stepper-text">
                  <strong>Brain heat map</strong>
                  <span className="muted small">Load a video or song, or try the demo</span>
                </div>
              )}
              <div className="seg-control" role="radiogroup" aria-label="Map layer" hidden={view === 'emotion'}>
                <button type="button" role="radio" aria-checked={mode === 'anatomy'} className={mode === 'anatomy' ? 'is-on' : ''} onClick={() => setMode('anatomy')}>
                  Regions
                </button>
                <button type="button" role="radio" aria-checked={mode === 'networks'} className={mode === 'networks' ? 'is-on' : ''} onClick={() => setMode('networks')}>
                  Networks
                </button>
              </div>
            </div>
            {view === 'research' && segment && (
              <div className="stepper" aria-label="Segment">
                <button type="button" className="icon-btn step-btn" aria-label="Previous segment" disabled={segIndex <= 0} onClick={() => goSegment(segIndex - 1)}>
                  ‹
                </button>
                <div className="stepper-text">
                  <strong>
                    Segment {segIndex + 1} of {segments.length}
                  </strong>
                  <span className="muted small">
                    {formatTime(segment.start)}–{formatTime(segment.end)} · {segment.label}
                  </span>
                </div>
                <button type="button" className="icon-btn step-btn" aria-label="Next segment" disabled={segIndex >= segments.length - 1} onClick={() => goSegment(segIndex + 1)}>
                  ›
                </button>
              </div>
            )}
            {focus && view === 'research' && (
              <div className="focus-bar small" role="status">
                Showing one association only: {db.associations.find((a) => a.id === focus)?.claim.slice(0, 90)}…
                <button type="button" className="btn small ghost" onClick={() => setFocus(null)}>
                  Show all
                </button>
              </div>
            )}
            <BrainView
              results={shown}
              mode={mode}
              selected={mesh}
              onSelect={selectMesh}
              onDetails={
                session
                  ? () =>
                      view === 'emotion'
                        ? chemCol.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        : view === 'heat' && mesh
                          ? why(mesh)
                          : rightCol.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  : undefined
              }
              theme={theme}
              isDemo={!!session?.isDemo}
              focusOn={focusReq}
              resetKey={session?.id}
              heat={view === 'emotion' ? emotionSource : heatSource}
            />
            {view === 'emotion' ? <EmotionLegend /> : view === 'heat' ? <HeatLegend /> : <Legend />}
            {mode === 'networks' && view !== 'emotion' && (
              <p className="small muted">
                Networks view: the 7 resting-state networks of Yeo et al. (2011) as parcellated by Schaefer et al. (2018). Only findings that the cited studies describe at network level
                are {view === 'heat' ? 'used' : 'coloured'} here; deep structures stay visible for context.
              </p>
            )}
          </section>
          {session && view === 'heat' && heatModel && <Waves model={heatModel} clock={clock} onSeek={seek} />}
          {session?.emotion && view === 'emotion' && <EmotionTrack tl={session.emotion} clock={clock} liking={liking} duration={session.duration} onSeek={seek} />}
        </div>

        <div className="col-side">
          {!session ? (
            <>
              <section className="card upload-card">
                <UploadPanel busy={busy} progress={progress} error={error} onAnalyze={analyze} onTranscriptOnly={transcriptOnly} onDemo={demo} onCancel={() => abort.current?.abort()}>
                  <DemoSongs songs={DEMO_SONGS} busy={busy} onPick={demoSong} />
                </UploadPanel>
              </section>
              <section className="card intro">
                <h2>How it works</h2>
                <ol className="how">
                  <li>
                    <strong>Listen.</strong> On this device, the app measures the cues that carry emotion in music (loudness, note density, tempo and beat, major or minor
                    harmony, clashing notes, brightness) and runs a music mood tagger trained on listeners' tags. For video it also reads colour, motion, cuts and faces.
                  </li>
                  <li>
                    <strong>Estimate the emotion.</strong> A model fitted to real listeners' moment-by-moment ratings turns those cues into how pleasant and how energetic
                    each moment is - joyful, tense, sad, calm and so on. On music it had never seen, it agreed with the average listener about as well as one listener does.
                  </li>
                  <li>
                    <strong>Map the brain systems.</strong> Published studies (brain scans, drug studies, meta-analyses) link those moments to the reward system (dopamine),
                    stress and threat areas, sadness and calm. The brain lights up in each system's colour as the media plays.
                  </li>
                </ol>
                <h2>What it can and can't tell you</h2>
                <p className="meaning">
                  Everything is an <strong>estimate for a typical listener</strong>, not a recording of anyone's brain. Dopamine release depends on whether you enjoy the music,
                  so you can tell the app. Serotonin is not shown: no study has measured it in the brain during music. The <em>Heat map</em> and <em>Evidence</em> views show
                  which areas process the sounds and pictures themselves.
                </p>
                <p className="small muted">
                  The evidence base holds {db.sources.length} sources and {db.associations.length} graded associations.
                </p>
              </section>
            </>
          ) : (
            <>
              <section className="card media-card">
                <MediaPanel ref={player} session={session} url={mediaUrl} onTime={onTime}>
                  {clock.virtual && <VirtualPlayer clock={clock} playing={isPlaying} time={time} duration={session.duration} onSeek={seek} />}
                </MediaPanel>
                {busy && progress && (
                  <div className="progress" role="status">
                    <div className="bar">
                      <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                    </div>
                    <span className="small">{progress.note}</span>
                    <button type="button" className="btn small ghost" onClick={() => abort.current?.abort()}>
                      Cancel
                    </button>
                  </div>
                )}
              </section>
              <section className="card actions-card" aria-label="Export and delete">
                <MediaActions
                  session={session}
                  follow={follow}
                  onFollow={view === 'research' ? setFollow : undefined}
                  onDelete={() => {
                    const wasDemo = session.isDemo;
                    reset();
                    setNotice(wasDemo ? null : 'Media and all results were deleted from this tab. Nothing had been uploaded or saved.');
                  }}
                  exportData={exportPayload}
                />
              </section>
              {view === 'emotion' && session.emotion && (
                <>
                  <EmotionNow tl={session.emotion} clock={clock} />
                  <div ref={chemCol} className="chem-wrap">
                    <ChemistryPanel
                      tl={session.emotion}
                      clock={clock}
                      liking={liking}
                      onLiking={setLiking}
                      onFocusRegion={(id) => {
                        setMesh(id);
                        setFocusReq((f) => ({ meshId: id, seq: (f?.seq ?? 0) + 1 }));
                        brainCol.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    />
                  </div>
                </>
              )}
              {view === 'emotion' && !session.emotion && <section className="card small">No audio or picture was analysed, so there is no emotion estimate.</section>}
              {view === 'heat' && heatModel && <HeatNow model={heatModel} clock={clock} networks={mode === 'networks'} onWhy={why} />}
              {view === 'research' && segment && segMap && (
                <aside className="card explain-card" aria-label="Explanation" ref={rightCol}>
                  <div className="tabs" role="tablist">
                    {(
                      [
                        ['highlighted', 'Highlighted'],
                        ['reasoning', 'Reasoning'],
                        ['features', 'Features'],
                      ] as [RightTab, string][]
                    ).map(([k, label]) => (
                      <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {tab === 'highlighted' &&
                    (mesh ? (
                      <RegionPanel
                        meshId={mesh}
                        results={shown}
                        onSelect={openDetails}
                        onBack={() => setMesh(null)}
                        onShowBrain={() => brainCol.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      />
                    ) : (
                      <HighlightedPanel
                        key={segment.id}
                        results={shown}
                        mode={mode}
                        onMode={setMode}
                        onSelect={openDetails}
                        segmentLabel={`segment ${segIndex + 1}`}
                        modalities={session.modalities}
                        isDemo={session.isDemo}
                      />
                    ))}
                  {tab === 'reasoning' && (
                    <>
                      <ListenerContextCard ctx={ctx} onChange={setCtx} />
                      <ReasoningPanel segment={segment} map={segMap} modalities={session.modalities} onSelectMesh={selectMesh} selectedMesh={mesh} focus={focus} onFocus={setFocus} />
                    </>
                  )}
                  {tab === 'features' && (
                    <FeaturePanel
                      segment={segment}
                      modalities={session.modalities}
                      overridden={overridden}
                      onConfirm={(id) => editFeature(id, 'confirm')}
                      onReject={(id) => editFeature(id, 'reject')}
                      onReset={(id) => editFeature(id, 'reset')}
                    />
                  )}
                </aside>
              )}
              <section className="card transcript-card">
                <TranscriptPanel cues={allCues} time={time} onSeek={seek} untimed={session.untimedTranscript}>
                  {!session.isDemo && HOSTED && <p className="small muted">{HOSTED_NETWORK_NOTE}</p>}
                  {!session.isDemo && !HOSTED && (
                    <div className="row wrap">
                      {session.mediaKind !== 'none' && !hasTimedText && (
                        <button type="button" className="btn small ghost" disabled={busy} onClick={() => setDialog('asr')}>
                          Transcribe locally…
                        </button>
                      )}
                      {hasTimedText && (
                        <button type="button" className="btn small ghost" disabled={busy} onClick={() => setDialog('llm')}>
                          Suggest interpretations…
                        </button>
                      )}
                    </div>
                  )}
                </TranscriptPanel>
              </section>
            </>
          )}
        </div>
      </main>

      {session && view === 'research' && (
        <Timeline session={session} segments={segments} selectedId={segment?.id ?? null} time={time} onSelect={(s) => (seek(s.start), selectSegment(s))} onSeek={seek} />
      )}

      <footer className="app-footer small muted">
        Anatomy: CerebrA atlas (Manera et al. 2020, CC BY 4.0) on the ICBM 2009c template; networks: Schaefer 2018 / Yeo 2011 (MIT). Evidence database v{db.meta.version}. Educational use
        only - not medical advice.
      </footer>

      {dialog === 'about' && <AboutModal onClose={() => setDialog(null)} />}
      {dialog === 'evidence' && <EvidenceBrowser onClose={() => setDialog(null)} />}
      {dialog === 'asr' && <AsrDialog onClose={() => setDialog(null)} onStart={startAsr} />}
      {dialog === 'llm' && <LlmDialog segmentCount={segments.filter((s) => s.cues.length).length} onClose={() => setDialog(null)} onStart={startLlm} />}
    </div>
  );
}
