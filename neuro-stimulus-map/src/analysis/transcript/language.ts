import type { TranscriptCue } from '../../pipeline/types';

/**
 * Transparent lexical cues computed from transcript text. These are word counts,
 * not language understanding; interpretive cues are labelled as such in the UI.
 */

const MENTAL_STATE = new Set(
  'think thinks thought believe believes believed know knows knew want wants wanted feel feels felt wonder wonders wondered realise realises realised realize realizes realized remember remembers remembered hope hopes hoped decide decides decided understand understands understood pretend pretends pretended suspect suspects suspected imagine imagines imagined expect expects expected wish wishes wished doubt doubts doubted guess guessed forget forgets forgot forgotten'.split(
    ' ',
  ),
);
const TEMPORAL = new Set('then after afterwards later when while before finally suddenly once meanwhile until next eventually'.split(' '));
const EMOTION = new Set(
  'happy sad angry afraid scared fear fearful joy joyful love loved hate hated terrified anxious worried furious delighted miserable lonely grief grieving cried crying tears laugh laughed laughing excited upset disgusted ashamed proud jealous nervous heartbroken thrilled calm'.split(
    ' ',
  ),
);
const LAUGHTER_RE = /\[(?:laughter|laughs|laughing|audience laughs)\]|\((?:laughter|laughs|laughing)\)|\b(?:haha+|hahaha+|lol)\b/gi;

export interface LanguageStats {
  words: number;
  wpm: number;
  mentalState: number;
  temporal: number;
  pastTense: number;
  thirdPerson: number;
  emotion: number;
  laughter: number;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(LAUGHTER_RE, ' ')
    .replace(/[^a-z'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Words overlapping [start, end), prorated for cues that straddle the boundary. */
export function cueTextIn(cues: TranscriptCue[], start: number, end: number): { text: string; spoken: number } {
  const parts: string[] = [];
  let spoken = 0;
  for (const c of cues) {
    if (c.end <= start || c.start >= end) continue;
    const dur = Math.max(0.001, c.end - c.start);
    const overlap = Math.min(end, c.end) - Math.max(start, c.start);
    if (overlap / dur >= 0.5 || (c.start >= start && c.start < end)) {
      parts.push(c.text);
      spoken += overlap;
    }
  }
  return { text: parts.join(' '), spoken };
}

export function languageStats(text: string, seconds: number): LanguageStats {
  const toks = tokenize(text);
  const laughter = (text.match(LAUGHTER_RE) ?? []).length;
  let mentalState = 0;
  let temporal = 0;
  let pastTense = 0;
  let thirdPerson = 0;
  let emotion = 0;
  for (const t of toks) {
    if (MENTAL_STATE.has(t)) mentalState++;
    if (TEMPORAL.has(t)) temporal++;
    if (t.length > 4 && t.endsWith('ed')) pastTense++;
    if (['he', 'she', 'they', 'him', 'her', 'them', 'his'].includes(t)) thirdPerson++;
    if (EMOTION.has(t)) emotion++;
  }
  return { words: toks.length, wpm: seconds > 0 ? (toks.length / seconds) * 60 : 0, mentalState, temporal, pastTense, thirdPerson, emotion, laughter };
}
