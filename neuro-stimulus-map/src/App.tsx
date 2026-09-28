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
import { Legend, ListenerContextCard } from './ui/Legend';
import { MediaPanel, TranscriptPanel } from './ui/MediaPanel';
import { ReasoningPanel } from './ui/ReasoningPanel';
import { RegionPanel } from './ui/RegionPanel';
import { Timeline } from './ui/Timeline';
import { UploadPanel } from './ui/UploadPanel';

type RightTab = 'reasoning' | 'features' | 'region';

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
  const [tab, setTab] = useState<RightTab>('reasoning');
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

  const seek = useCallback(
    (t: number) => {
      setTime(t);
      if (player.current) player.current.currentTime = t;
      const s = segments.find((x) => t >= x.start && t < x.end);
      if (s) setSegId(s.id);
    },
    [segments],
  );

  const onTime = useCallback(
    (t: number) => {
      setTime(t);
      if (!follow) return;
      const s = segments.find((x) => t >= x.start && t < x.end);
      if (s && s.id !== segId) setSegId(s.id);
    },
    [follow, segments, segId],
  );

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
    setTab('reasoning');
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

  const demo = () => {
    reset();
    const s = demoSession();
    setSession(s);
    setSegId(s.segments[0].id);
    setNotice(null);
  };

  const exportJson = () => {
    if (!session) return;
    const payload = {
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    a.download = `stimulus-association-map-${session.isDemo ? 'demo' : 'analysis'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
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
      setTab('region');
      if (id.includes('_yeo7_') && mode !== 'networks') setMode('networks');
      else if (!id.includes('_yeo7_') && mode === 'networks' && /^(L|R)_/.test(id)) {
        const cortical = db.regions.find((r) => Object.values(r.meshes).includes(id))?.kind === 'cortical';
        if (cortical) setMode('anatomy');
      }
    }
  };

  const overridden = new Set(Object.keys((segment && overrides[segment.id]) ?? {}) as FeatureId[]);
  const hasTimedText = segments.some((s) => s.cues.length);

  return (
    <div className={`app ${session ? 'has-session' : 'landing'}`}>
      <header className="app-header">
        <div className="brand">
          <h1>Stimulus Association Map</h1>
          <p className="tagline">A research-based stimulus association map - not a brain scan</p>
        </div>
        <nav className="header-actions" aria-label="Help and evidence">
          <button type="button" className="btn ghost" onClick={() => setDialog('about')}>
            How to read this map
          </button>
          <button type="button" className="btn ghost" onClick={() => setDialog('evidence')}>
            Evidence database
          </button>
        </nav>
      </header>

      <div className="banner" role="note">
        Colours show how strongly <strong>published research</strong> links the <em>kinds of stimuli detected in this media</em> to brain regions. They do not show anyone's brain activity.
        {session?.isDemo && <strong className="demo-flag"> DEMO DATA - hand-authored features, no media analysed.</strong>}
      </div>
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

      <main className="layout">
        <aside className="col-left">
          {!session ? (
            <UploadPanel busy={busy} progress={progress} error={error} onAnalyze={analyze} onTranscriptOnly={transcriptOnly} onDemo={demo} onCancel={() => abort.current?.abort()} />
          ) : (
            <>
              <MediaPanel
                ref={player}
                session={session}
                url={mediaUrl}
                time={time}
                follow={follow}
                onFollow={setFollow}
                onTime={onTime}
                onDelete={() => {
                  const wasDemo = session.isDemo;
                  reset();
                  setNotice(wasDemo ? null : 'Media and all results were deleted from this tab. Nothing had been uploaded or saved.');
                }}
                onExport={exportJson}
              />
              <TranscriptPanel cues={allCues} time={time} onSeek={seek} untimed={session.untimedTranscript}>
                {!session.isDemo && (
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
            </>
          )}
        </aside>

        <section className="col-center" aria-label="Brain map">
          <div className="map-head">
            <div className="seg-toggle" role="radiogroup" aria-label="Map layer">
              <button type="button" role="radio" aria-checked={mode === 'anatomy'} className={`chip ${mode === 'anatomy' ? 'is-on' : ''}`} onClick={() => setMode('anatomy')}>
                Anatomical regions
              </button>
              <button type="button" role="radio" aria-checked={mode === 'networks'} className={`chip ${mode === 'networks' ? 'is-on' : ''}`} onClick={() => setMode('networks')}>
                Distributed networks
              </button>
            </div>
            {segment && (
              <span className="muted small">
                Showing segment {segment.index + 1} of {segments.length}
              </span>
            )}
          </div>
          {focus && (
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
            onDetails={session ? () => rightCol.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : undefined}
            theme={theme}
            isDemo={!!session?.isDemo}
          />
          <Legend />
          {mode === 'networks' && (
            <p className="small muted">
              Network layer: the 7 resting-state networks of Yeo et al. (2011) as parcellated by Schaefer et al. (2018). Only findings that the cited studies describe at network level are
              coloured here; subcortical structures remain visible for context.
            </p>
          )}
        </section>

        <aside className="col-right" aria-label="Explanation" ref={rightCol}>
          {!session || !segment || !segMap ? (
            <div className="intro">
              <h2>How it works</h2>
              <ol className="small">
                <li>
                  <strong>Detect</strong> measurable features in your media, locally: speech- and music-like sound, beat, loudness changes, sudden sounds, motion, cuts, faces, and
                  (with a transcript) language cues.
                </li>
                <li>
                  <strong>Link</strong> each feature to candidate processes through reviewed rules that state how direct the link is.
                </li>
                <li>
                  <strong>Look up</strong> curated, cited research for those processes. Only verified records colour the brain; everything else stays gray as "insufficient evidence".
                </li>
              </ol>
              <p className="small muted">
                The evidence base holds {db.sources.length} sources, {db.associations.length} graded associations and {db.unsupported.length} explicitly unsupported mappings.
              </p>
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist">
                <button type="button" role="tab" aria-selected={tab === 'reasoning'} className={`tab ${tab === 'reasoning' ? 'is-active' : ''}`} onClick={() => setTab('reasoning')}>
                  Reasoning
                </button>
                <button type="button" role="tab" aria-selected={tab === 'features'} className={`tab ${tab === 'features' ? 'is-active' : ''}`} onClick={() => setTab('features')}>
                  Features
                </button>
                <button type="button" role="tab" aria-selected={tab === 'region'} className={`tab ${tab === 'region' ? 'is-active' : ''}`} onClick={() => setTab('region')} disabled={!mesh}>
                  Region
                </button>
              </div>
              <ListenerContextCard ctx={ctx} onChange={setCtx} />
              {tab === 'reasoning' && (
                <ReasoningPanel segment={segment} map={segMap} modalities={session.modalities} onSelectMesh={selectMesh} selectedMesh={mesh} focus={focus} onFocus={setFocus} />
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
              {tab === 'region' && mesh && (
                <RegionPanel
                  meshId={mesh}
                  result={segMap.meshes.get(mesh)}
                  onClose={() => {
                    setMesh(null);
                    setTab('reasoning');
                  }}
                />
              )}
            </>
          )}
        </aside>
      </main>

      {session && <Timeline session={session} segments={segments} selectedId={segment?.id ?? null} time={time} onSelect={(s) => (seek(s.start), selectSegment(s))} onSeek={seek} />}

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
