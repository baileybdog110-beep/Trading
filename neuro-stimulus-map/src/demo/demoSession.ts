/**
 * DEMONSTRATION DATA - hand-authored, not produced by analysing any media.
 * It exists so the interface can be explored without uploading a file. It is kept
 * separate from real analysis and is always labelled as a demo in the UI.
 */
import type { FeatureId } from '../evidence/types';
import type { AnalysisSession, DetectedFeature, Segment, TranscriptCue } from '../pipeline/types';

const d = (
  id: FeatureId,
  present: boolean,
  confidence: DetectedFeature['confidence'],
  measurement: string,
  status: DetectedFeature['status'] = 'auto',
  values?: DetectedFeature['values'],
): DetectedFeature => ({ id, present, confidence, status, source: 'demo', measurement: `[demo] ${measurement}`, values });

const cues: TranscriptCue[] = [
  { start: 21, end: 27, text: 'When my grandmother moved to the coast, she thought the sea would be the hardest thing to get used to.' },
  { start: 27.5, end: 34, text: 'Later she realised it was the silence at night. She wanted to hear the traffic again.' },
  { start: 34.5, end: 41, text: 'She told me she used to leave a radio on, just so the house felt like it was listening.' },
  { start: 41.5, end: 53, text: 'Then one winter the storm came through, and the power went out across the whole town.' },
  { start: 72, end: 78, text: 'So I asked her, did you ever go back? And she said, back to what, the parking tickets?' },
  { start: 78.5, end: 83, text: '[laughter] She was never sentimental about the city.' },
  { start: 83.5, end: 98, text: 'Honestly I think she knew exactly what she was doing. She always did.' },
  { start: 131, end: 145, text: 'At the funeral we played the song she used to hum in the kitchen, and nobody could get through the chorus.' },
  { start: 146, end: 158, text: 'I still hear it when the wind comes off the water.' },
];

function seg(index: number, start: number, end: number, label: string, feats: DetectedFeature[]): Segment {
  const features: Segment['features'] = {};
  for (const f of feats) features[f.id] = f;
  return { id: `demo${index}`, index, start, end, label, features, cues: cues.filter((c) => c.end > start && c.start < end) };
}

export function demoSession(): AnalysisSession {
  const segments: Segment[] = [
    seg(0, 0, 20, 'Music · cut', [
      d('sound_present', true, 'high', 'Sound in 98% of frames.'),
      d('music_present', true, 'moderate', 'Music-like cues in 90% of windows.'),
      d('speech_present', false, 'low', 'Speech-like cues in 5% of windows.'),
      d('regular_beat', true, 'moderate', 'Periodic onsets at about 104 BPM (pulse clarity 0.71).', 'auto', { bpm: 104, pulseClarity: 0.71 }),
      d('loudness_change', false, 'high', 'Level range 6 dB.'),
      d('abrupt_onset', false, 'moderate', 'No sharp level rises.'),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('visual_motion', true, 'moderate', 'Motion in 70% of frame pairs.'),
      d('scene_cut', true, 'moderate', '3 shot changes.'),
      d('faces_visible', false, 'moderate', 'Face in 0% of checked frames.'),
      d('luminance_change', false, 'moderate', 'Largest brightness change 6%.'),
    ]),
    seg(1, 20, 55, 'Speech · faces', [
      d('sound_present', true, 'high', 'Sound in 95% of frames.'),
      d('speech_present', true, 'high', 'Timestamped transcript has 70 words.'),
      d('music_present', false, 'low', 'Music-like cues in 10% of windows.'),
      d('transcribed_speech', true, 'high', '70 words, about 150 words per minute.', 'auto', { words: 70, wpm: 150 }),
      d('narrative_cues', true, 'moderate', 'Narrative cues are 14% of words.'),
      d('mental_state_language', true, 'moderate', '4 mental-state verbs (5.7 per 100 words).'),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('faces_visible', true, 'moderate', 'Face in 85% of checked frames; largest face 18% of frame.'),
      d('visual_motion', false, 'low', 'Motion in 12% of frame pairs.'),
      d('scene_cut', false, 'moderate', 'No shot changes.'),
    ]),
    seg(2, 55, 70, 'Other sound · cut · sudden sound', [
      d('sound_present', true, 'high', 'Sound in 80% of frames.'),
      d('speech_present', false, 'low', 'Speech-like cues in 0% of windows.'),
      d('abrupt_onset', true, 'moderate', '1 sharp level rise at 57.2 s.'),
      d('loudness_change', true, 'high', 'Level range 24 dB.'),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('scene_cut', true, 'moderate', '1 shot change at 57.2 s.'),
      d('luminance_change', true, 'moderate', 'Largest brightness change 41%.'),
      d('visual_motion', true, 'moderate', 'Motion in 66% of frame pairs.'),
      d('situation_change', true, 'high', 'Marked by a person: the storm scene begins.', 'confirmed'),
    ]),
    seg(3, 70, 100, 'Speech · faces', [
      d('sound_present', true, 'high', 'Sound in 96% of frames.'),
      d('speech_present', true, 'high', 'Timestamped transcript has 48 words.'),
      d('transcribed_speech', true, 'high', '48 words, about 160 words per minute.', 'auto', { words: 48, wpm: 160 }),
      d('laughter_marker', true, 'high', '1 laughter annotation.'),
      d('humor', true, 'low', 'Suggested because the transcript marks laughter. Confirm or reject.', 'suggested'),
      d('mental_state_language', true, 'low', '2 mental-state verbs (4.2 per 100 words).'),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('faces_visible', true, 'moderate', 'Face in 92% of checked frames.'),
    ]),
    seg(4, 100, 130, 'Other sound', [
      d('sound_present', true, 'high', 'Sound in 70% of frames.'),
      d('music_present', true, 'low', 'Music-like cues in 45% of windows.'),
      d('regular_beat', false, 'low', 'No clear periodic beat (pulse clarity 0.21).', 'auto', { bpm: 0, pulseClarity: 0.21 }),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('visual_motion', true, 'moderate', 'Motion in 75% of frame pairs.'),
      d('places_layout', true, 'high', 'Marked by a person: wide shots of the coastline and the empty house.', 'confirmed'),
      d('suspense', true, 'high', 'Marked by a person: the narration builds towards an unknown outcome.', 'confirmed'),
    ]),
    seg(5, 130, 160, 'Speech + music', [
      d('sound_present', true, 'high', 'Sound in 99% of frames.'),
      d('speech_present', true, 'high', 'Timestamped transcript has 34 words.'),
      d('music_present', true, 'moderate', 'Music-like cues in 75% of windows.'),
      d('singing_possible', true, 'low', 'Speech-like and music-like cues together in 40% of windows.'),
      d('transcribed_speech', true, 'high', '34 words, about 140 words per minute.', 'auto', { words: 34, wpm: 140 }),
      d('emotion_words', false, 'moderate', '0 words from the emotion-word list.'),
      d('emotional_theme', true, 'high', 'Marked by a person: grief.', 'confirmed'),
      d('visual_input', true, 'high', 'All sampled frames non-black.'),
      d('faces_visible', true, 'low', 'Face in 35% of checked frames.'),
    ]),
  ];
  const n = 320;
  const wave = (f: (t: number) => number) => Array.from({ length: n }, (_, i) => f(i * 0.5));
  return {
    id: 'demo',
    isDemo: true,
    mediaName: 'Demo: fictional 2:40 video essay (no media)',
    mediaKind: 'none',
    duration: 160,
    createdAt: new Date().toISOString(),
    modalities: {
      audio: { state: 'not-analyzed', detail: 'DEMO: features are hand-authored; no audio was analysed.' },
      video: { state: 'not-analyzed', detail: 'DEMO: features are hand-authored; no video was analysed.' },
      faces: { state: 'not-analyzed', detail: 'DEMO: hand-authored.' },
      transcript: { state: 'analyzed', detail: 'DEMO: fictional transcript written for this demonstration.', timed: true, origin: 'demo' },
    },
    segments,
    tracks: {
      step: 0.5,
      level: wave((t) => (t < 20 ? -14 : t < 55 ? -18 : t < 57 ? -30 : t < 60 ? -6 : t < 70 ? -16 : t < 100 ? -18 : t < 130 ? -24 : -15) + 2 * Math.sin(t * 3)),
      speech: wave((t) => ((t > 20 && t < 55) || (t > 70 && t < 100) || t > 130 ? 0.75 : 0.1)),
      music: wave((t) => (t < 20 ? 0.85 : t > 100 && t < 130 ? 0.45 : t > 130 ? 0.7 : 0.05)),
      motion: wave((t) => (t < 20 ? 0.7 : t > 55 && t < 70 ? 0.8 : t > 100 && t < 130 ? 0.6 : 0.15)),
      faces: wave((t) => ((t > 20 && t < 55) || (t > 70 && t < 100) || (t > 135 && t < 150) ? 1 : 0)),
      onsets: [57.2],
      cuts: [6, 12, 17, 57.2],
    },
    notes: ['This is demonstration data. Upload a file to run a real, local analysis.'],
  };
}
