/**
 * Turns modality analyses into timeline segments with detected features.
 * Pure (no DOM), so it is unit-tested with synthetic media.
 *
 * Rules that matter for honesty:
 *  - A modality that was not analysed contributes NO features (they are not guessed).
 *  - Detection confidence never exceeds 'moderate' for heuristic detectors.
 *  - Interpretive cues (laughter markers, emotion words) only create *suggested* features.
 */
import type { FeatureId } from '../evidence/types';
import type { DetectedFeature, Segment, TimelineTracks, TranscriptCue } from '../pipeline/types';
import type { AudioAnalysis } from './audio/analyze';
import { FPS, SILENCE_DB, beatStrength, percentile } from './audio/dsp';
import { cueTextIn, languageStats } from './transcript/language';
import type { VideoAnalysis } from './video/types';

export interface AssembleInput {
  duration: number;
  audio: AudioAnalysis | null;
  video: VideoAnalysis | null;
  cues: TranscriptCue[];
}

export const SPEECH_T = 0.45;
export const MUSIC_T = 0.5;
const MOTION_T = 0.04; // summary-frame widths per second
const LUMA_JUMP = 0.15;

type Label = 'silent' | 'speech' | 'music' | 'both' | 'other';

/** Speech score reduced where music-like cues are strong (speech and music cues overlap). */
export const adjSpeech = (speech: number, music: number) => speech * (1 - 0.6 * music);

export function windowLabels(audio: AudioAnalysis): Label[] {
  const raw: Label[] = audio.windows.map((w) => {
    if (w.silent) return 'silent';
    const s = adjSpeech(w.speech, w.music) >= SPEECH_T;
    const m = w.music >= MUSIC_T;
    return s && m ? 'both' : s ? 'speech' : m ? 'music' : 'other';
  });
  // mode filter over 3 windows to suppress flicker
  return raw.map((_, i) => {
    const counts = new Map<Label, number>();
    for (let k = Math.max(0, i - 1); k <= Math.min(raw.length - 1, i + 1); k++) counts.set(raw[k], (counts.get(raw[k]) ?? 0) + 1);
    let best: Label = raw[i];
    let bc = 0;
    for (const [l, c] of counts) if (c > bc || (c === bc && l === raw[i])) [best, bc] = [l, c];
    return best;
  });
}

interface Candidate {
  t: number;
  strength: number;
}

export function segmentBoundaries(input: AssembleInput): number[] {
  const { duration } = input;
  const minLen = Math.min(30, Math.max(4, duration / 150));
  const maxLen = Math.min(90, Math.max(15, minLen * 4));
  const cands: Candidate[] = [];
  if (input.audio) {
    const labels = windowLabels(input.audio);
    for (let i = 1; i < labels.length; i++) if (labels[i] !== labels[i - 1]) cands.push({ t: input.audio.windows[i].t, strength: 1 });
    for (const t of input.audio.onsets) cands.push({ t, strength: 0.7 });
  }
  if (input.video) for (const t of input.video.cuts) cands.push({ t, strength: 0.8 });
  for (let i = 1; i < input.cues.length; i++) {
    if (input.cues[i].start - input.cues[i - 1].end >= 1.5) cands.push({ t: input.cues[i].start, strength: 0.5 });
  }
  cands.sort((a, b) => a.t - b.t);
  const merged: Candidate[] = [];
  for (const c of cands) {
    const last = merged[merged.length - 1];
    if (last && c.t - last.t < 1) last.strength = Math.max(last.strength, c.strength);
    else merged.push({ ...c });
  }
  const quietest = (a: number, b: number): number => {
    const db = input.audio?.frames.db;
    if (!db) return (a + b) / 2;
    let best = a;
    let bestDb = Infinity;
    for (let i = Math.floor(a * FPS); i < Math.min(db.length, Math.floor(b * FPS)); i++) {
      if (db[i] < bestDb) {
        bestDb = db[i];
        best = i / FPS;
      }
    }
    return best;
  };
  const bounds = [0];
  const accepted = merged.filter((c) => c.strength >= 0.5 && c.t > 0 && c.t < duration);
  let ci = 0;
  while (true) {
    const last = bounds[bounds.length - 1];
    if (duration - last <= maxLen) {
      // take remaining strong candidates while leaving room for a final segment
      while (ci < accepted.length) {
        const c = accepted[ci++];
        const prev = bounds[bounds.length - 1];
        if (c.t - prev >= minLen && duration - c.t >= minLen / 2) bounds.push(c.t);
      }
      break;
    }
    // next candidate within [last+minLen, last+maxLen]
    const inWindow = accepted.filter((c) => c.t >= last + minLen && c.t <= last + maxLen);
    if (inWindow.length) {
      bounds.push(inWindow[0].t);
      ci = accepted.indexOf(inWindow[0]) + 1;
    } else {
      bounds.push(quietest(last + minLen, last + maxLen));
      while (ci < accepted.length && accepted[ci].t <= bounds[bounds.length - 1]) ci++;
    }
  }
  bounds.push(duration);
  return bounds;
}

const f = (
  id: FeatureId,
  present: boolean,
  confidence: DetectedFeature['confidence'],
  source: DetectedFeature['source'],
  measurement: string,
  values?: DetectedFeature['values'],
  status: DetectedFeature['status'] = 'auto',
): DetectedFeature => ({ id, present, confidence, source, measurement, values, status });

const pct = (x: number) => `${Math.round(x * 100)}%`;

function audioFeatures(audio: AudioAnalysis, a: number, b: number, prevLevel: number | null): { feats: DetectedFeature[]; level: number | null } {
  const feats: DetectedFeature[] = [];
  const fa = Math.floor(a * FPS);
  const fb = Math.min(audio.frames.db.length, Math.floor(b * FPS));
  const db = audio.frames.db.slice(fa, fb);
  const activeFrac = db.length ? db.filter((x) => x > SILENCE_DB).length / db.length : 0;
  feats.push(
    f('sound_present', activeFrac >= 0.2, activeFrac >= 0.5 ? 'high' : 'moderate', 'audio', `Signal above ${SILENCE_DB} dBFS in ${pct(activeFrac)} of 20-ms frames.`, {
      activeFraction: +activeFrac.toFixed(2),
    }),
  );
  const wins = audio.windows.filter((w) => w.t >= a - 0.01 && w.t + 1 <= b + 0.01 && !w.silent);
  const n = Math.max(1, wins.length);
  const speechFrac = wins.filter((w) => adjSpeech(w.speech, w.music) >= SPEECH_T).length / n;
  const musicFrac = wins.filter((w) => w.music >= MUSIC_T).length / n;
  const bothFrac = wins.filter((w) => adjSpeech(w.speech, w.music) >= 0.35 && w.music >= 0.35).length / n;
  // require at least 3 s of speech-like (or music-like) audio so brief noises are not labelled
  const speechWins = Math.round(speechFrac * wins.length);
  const musicWins = Math.round(musicFrac * wins.length);
  const enough = wins.length >= 2;
  feats.push(
    f('speech_present', speechWins >= 3 && speechFrac >= 0.4, speechFrac >= 0.7 ? 'moderate' : 'low', 'audio', `Speech-like acoustic cues in ${pct(speechFrac)} of non-silent 1-s windows (heuristic).`, {
      speechLikeFraction: +speechFrac.toFixed(2),
    }),
  );
  const beat = beatStrength(audio.frames.flux, fa, fb);
  feats.push(
    f('music_present', musicWins >= 3 && musicFrac >= 0.4, musicFrac >= 0.7 && beat.clarity >= 0.3 ? 'moderate' : 'low', 'audio', `Music-like acoustic cues in ${pct(musicFrac)} of non-silent 1-s windows (heuristic).`, {
      musicLikeFraction: +musicFrac.toFixed(2),
    }),
  );
  feats.push(f('singing_possible', enough && bothFrac >= 0.3, 'low', 'audio', `Speech-like and music-like cues together in ${pct(bothFrac)} of windows.`));
  if (b - a >= 6) {
    feats.push(
      f(
        'regular_beat',
        beat.clarity >= 0.4,
        beat.clarity >= 0.6 ? 'moderate' : 'low',
        'audio',
        beat.clarity >= 0.4
          ? `Periodic onsets at about ${Math.round(beat.bpm)} BPM (pulse clarity ${beat.clarity.toFixed(2)}; tempo may be off by a factor of 2).`
          : `No clear periodic beat (pulse clarity ${beat.clarity.toFixed(2)}).`,
        { bpm: Math.round(beat.bpm), pulseClarity: +beat.clarity.toFixed(2) },
      ),
    );
  }
  // 1-s power-average levels over audible stretches
  const secLevels: number[] = [];
  for (let i = fa; i + FPS <= fb; i += FPS) {
    let p = 0;
    let act = 0;
    for (let k = i; k < i + FPS; k++) {
      p += Math.pow(10, audio.frames.db[k] / 10);
      if (audio.frames.db[k] > SILENCE_DB) act++;
    }
    if (act / FPS >= 0.5) secLevels.push(10 * Math.log10(p / FPS));
  }
  const level = secLevels.length ? 10 * Math.log10(secLevels.reduce((s, x) => s + Math.pow(10, x / 10), 0) / secLevels.length) : null;
  const range = secLevels.length >= 3 ? percentile(secLevels, 90) - percentile(secLevels, 10) : 0;
  const delta = level !== null && prevLevel !== null ? level - prevLevel : 0;
  feats.push(
    f(
      'loudness_change',
      range >= 12 || Math.abs(delta) >= 10,
      'high',
      'audio',
      `Level range within segment ${range.toFixed(0)} dB; change from previous segment ${delta >= 0 ? '+' : ''}${delta.toFixed(0)} dB (relative to the file, not playback volume).`,
      { rangeDb: +range.toFixed(1), deltaDb: +delta.toFixed(1) },
    ),
  );
  const onsets = audio.onsets.filter((t) => t >= a && t < b);
  feats.push(
    f(
      'abrupt_onset',
      onsets.length > 0,
      'moderate',
      'audio',
      onsets.length ? `${onsets.length} sharp level rise(s) of 20 dB or more above the preceding second, at ${onsets.map((t) => `${t.toFixed(1)} s`).join(', ')}.` : 'No sharp level rises detected.',
      { count: onsets.length },
    ),
  );
  return { feats, level };
}

function videoFeatures(video: VideoAnalysis, a: number, b: number): DetectedFeature[] {
  const feats: DetectedFeature[] = [];
  const ss = video.samples.filter((s) => s.t >= a && s.t < b);
  if (!ss.length) return feats;
  const cutsHere = video.cuts.filter((t) => t >= a - 0.26 && t < b - 0.26);
  const cutSet = new Set(video.cuts.map((t) => t.toFixed(3)));
  const nonBlack = ss.filter((s) => s.luma > 8 / 255).length / ss.length;
  feats.push(f('visual_input', nonBlack >= 0.5, 'high', 'video', `${pct(nonBlack)} of sampled frames are not black.`));
  // samples at or just after a flash reflect a brightness change, not motion
  const flashes = video.flashes ?? [];
  const nearFlash = (t: number) => flashes.some((x) => t >= x - 0.01 && t - x <= 3 * video.step + 0.01);
  const pairs = ss.filter((s) => s !== video.samples[0] && !cutSet.has(s.t.toFixed(3)) && !nearFlash(s.t));
  const moving = pairs.filter((s) => s.motion >= MOTION_T || s.changed >= 0.03).length / Math.max(1, pairs.length);
  feats.push(
    f('visual_motion', pairs.length >= 2 && moving >= 0.3, moving >= 0.6 ? 'moderate' : 'low', 'video', `Motion (block displacement or at least 3% of pixels changing) in ${pct(moving)} of sampled frame pairs - a coarse proxy that does not separate camera and object motion.`, {
      movingFraction: +moving.toFixed(2),
    }),
  );
  let maxJump = 0;
  for (let i = 0; i < video.samples.length; i++) {
    const s = video.samples[i];
    if (s.t < a || s.t >= b || i === 0 || cutSet.has(s.t.toFixed(3))) continue;
    maxJump = Math.max(maxJump, Math.abs(s.luma - video.samples[i - 1].luma));
  }
  const flashesHere = flashes.filter((t) => t >= a && t < b);
  feats.push(
    f(
      'luminance_change',
      maxJump >= LUMA_JUMP || flashesHere.length > 0,
      'moderate',
      'video',
      `Largest brightness change between sampled frames (excluding cuts): ${pct(maxJump)} of full scale${flashesHere.length ? `; brief flash at ${flashesHere.map((t) => `${t.toFixed(1)} s`).join(', ')}` : ''}.`,
    ),
  );
  feats.push(
    f('scene_cut', cutsHere.length > 0, 'moderate', 'video', cutsHere.length ? `${cutsHere.length} shot change(s) at ${cutsHere.map((t) => `${t.toFixed(1)} s`).join(', ')}.` : 'No shot changes detected.', {
      count: cutsHere.length,
    }),
  );
  if (video.facesAnalyzed) {
    const checked = ss.filter((s) => s.faces !== null);
    if (checked.length) {
      const withFace = checked.filter((s) => (s.faces ?? 0) > 0).length / checked.length;
      const maxArea = Math.max(0, ...checked.map((s) => s.faceArea ?? 0));
      feats.push(
        f('faces_visible', withFace >= 0.3, withFace >= 0.6 ? 'moderate' : 'low', 'video', `Face detected in ${pct(withFace)} of ${checked.length} checked frames; largest face ${pct(maxArea)} of frame.`, {
          faceFraction: +withFace.toFixed(2),
          largestFaceArea: +maxArea.toFixed(3),
        }),
      );
    }
  }
  return feats;
}

function transcriptFeatures(cues: TranscriptCue[], a: number, b: number): DetectedFeature[] {
  const feats: DetectedFeature[] = [];
  const { text, spoken } = cueTextIn(cues, a, b);
  const st = languageStats(text, spoken);
  feats.push(
    f('transcribed_speech', st.words >= 5, 'high', 'transcript', st.words ? `${st.words} transcribed words, about ${Math.round(st.wpm)} words per minute while speaking.` : 'No transcribed words in this interval.', {
      words: st.words,
      wpm: Math.round(st.wpm),
    }),
  );
  if (st.words >= 40) {
    const cue = (st.temporal + st.pastTense + st.thirdPerson) / st.words;
    feats.push(
      f('narrative_cues', cue >= 0.08, cue >= 0.12 ? 'moderate' : 'low', 'transcript', `Narrative word cues (time connectives, past tense, third-person references) make up ${pct(cue)} of words.`, {
        cueRate: +cue.toFixed(3),
      }),
    );
  }
  if (st.words >= 20) {
    const per100 = (st.mentalState / st.words) * 100;
    feats.push(
      f('mental_state_language', st.mentalState >= 2 && per100 >= 2, per100 >= 3 ? 'moderate' : 'low', 'transcript', `${st.mentalState} mental-state verbs (${per100.toFixed(1)} per 100 words).`, {
        count: st.mentalState,
      }),
    );
  }
  feats.push(f('laughter_marker', st.laughter > 0, 'high', 'transcript', st.laughter ? `${st.laughter} laughter annotation(s) in the transcript.` : 'No laughter annotations.'));
  if (st.laughter > 0) {
    feats.push(f('humor', true, 'low', 'transcript', 'Suggested because the transcript marks laughter. Confirm or reject.', undefined, 'suggested'));
  }
  feats.push(f('emotion_words', st.emotion >= 2, 'moderate', 'transcript', `${st.emotion} word(s) from a small emotion-word list.`, { count: st.emotion }));
  return feats;
}

function label(feats: Partial<Record<FeatureId, DetectedFeature>>): string {
  const on = (id: FeatureId) => feats[id]?.present;
  const parts: string[] = [];
  const speech = on('speech_present') || on('transcribed_speech');
  if (speech && on('music_present')) parts.push('Speech + music');
  else if (speech) parts.push('Speech');
  else if (on('music_present')) parts.push('Music');
  else if (feats.sound_present && !on('sound_present')) parts.push('Quiet');
  else if (on('sound_present')) parts.push('Other sound');
  if (on('faces_visible')) parts.push('faces');
  if (on('scene_cut')) parts.push('cut');
  if (on('abrupt_onset')) parts.push('sudden sound');
  return parts.join(' · ') || 'Visual only';
}

export function assemble(input: AssembleInput): { segments: Segment[]; tracks: TimelineTracks } {
  const bounds = segmentBoundaries(input);
  const segments: Segment[] = [];
  let prevLevel: number | null = null;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const feats: Partial<Record<FeatureId, DetectedFeature>> = {};
    if (input.audio) {
      const r = audioFeatures(input.audio, a, b, prevLevel);
      if (r.level !== null) prevLevel = r.level;
      for (const x of r.feats) feats[x.id] = x;
    }
    if (input.video) for (const x of videoFeatures(input.video, a, b)) feats[x.id] = x;
    if (input.cues.length) {
      for (const x of transcriptFeatures(input.cues, a, b)) feats[x.id] = x;
      // Timestamped words are direct evidence of speech in the interval (source: transcript).
      const words = feats.transcribed_speech?.values?.words as number | undefined;
      if (words && words >= 5) {
        const audioNote = feats.speech_present?.source === 'audio' ? ` Audio heuristic: ${feats.speech_present.measurement}` : ' Audio was not analysed.';
        feats.speech_present = f('speech_present', true, 'high', 'transcript', `Timestamped transcript has ${words} words in this interval.${audioNote}`);
      }
    }
    const cues = input.cues.filter((c) => c.end > a && c.start < b);
    segments.push({ id: `s${i}`, index: i, start: a, end: b, label: label(feats), features: feats, cues });
  }
  const tracks: TimelineTracks = { step: 0.5 };
  if (input.audio) {
    const per = Math.round(FPS * 0.5);
    const lv: number[] = [];
    for (let i = 0; i < input.audio.frames.db.length; i += per) lv.push(Math.max(-80, Math.max(...input.audio.frames.db.slice(i, i + per))));
    tracks.level = lv;
    tracks.speech = input.audio.windows.flatMap((w) => [adjSpeech(w.speech, w.music), adjSpeech(w.speech, w.music)]);
    tracks.music = input.audio.windows.flatMap((w) => [w.music, w.music]);
    tracks.onsets = input.audio.onsets;
  }
  if (input.video) {
    const rs = (vals: number[]) => {
      const out: number[] = [];
      for (let t = 0; t < input.duration; t += 0.5) {
        const k = Math.min(vals.length - 1, Math.round(t / input.video!.step));
        out.push(vals[k] ?? 0);
      }
      return out;
    };
    tracks.motion = rs(input.video.samples.map((s) => Math.min(1, s.motion / (MOTION_T * 4))));
    if (input.video.facesAnalyzed) {
      let last = 0;
      tracks.faces = rs(
        input.video.samples.map((s) => {
          if (s.faces !== null) last = s.faces > 0 ? 1 : 0;
          return last;
        }),
      );
    }
    tracks.cuts = input.video.cuts;
  }
  return { segments, tracks };
}
