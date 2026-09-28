import type { TranscriptCue } from '../../pipeline/types';

export interface ParsedTranscript {
  cues: TranscriptCue[];
  timed: boolean;
  format: 'srt' | 'vtt' | 'json' | 'text';
  /** full text for untimed transcripts */
  text?: string;
}

const TIME_RE = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

export function parseTimestamp(s: string): number {
  const m = TIME_RE.exec(s.trim());
  if (!m) return NaN;
  const [, h, mm, ss, frac] = m;
  return (h ? +h * 3600 : 0) + +mm * 60 + +ss + +frac.padEnd(3, '0') / 1000;
}

function parseCueBlocks(src: string): TranscriptCue[] {
  const cues: TranscriptCue[] = [];
  const blocks = src.replace(/\r/g, '').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b.split(/\s+/).filter(Boolean)[0] ?? '');
    const text = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && text) cues.push({ start, end, text });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/**
 * Parse SRT, WebVTT, Whisper-style JSON ({segments|chunks: [{start,end,text}|{timestamp:[s,e],text}]})
 * or plain text (untimed).
 */
export function parseTranscript(name: string, src: string): ParsedTranscript {
  const lower = name.toLowerCase();
  const trimmed = src.trim();
  if (lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const j = JSON.parse(trimmed);
      const list: unknown[] = Array.isArray(j) ? j : j.segments ?? j.chunks ?? [];
      const cues = list
        .map((c) => {
          const o = c as { start?: number; end?: number; timestamp?: [number, number | null]; text?: string };
          const start = o.start ?? o.timestamp?.[0];
          const end = o.end ?? o.timestamp?.[1] ?? start;
          return { start: Number(start), end: Number(end), text: String(o.text ?? '').trim() };
        })
        .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.text);
      if (cues.length) return { cues, timed: true, format: 'json' };
    } catch {
      /* fall through to text */
    }
  }
  if (trimmed.startsWith('WEBVTT') || lower.endsWith('.vtt')) {
    const cues = parseCueBlocks(trimmed.replace(/^WEBVTT[^\n]*\n/, ''));
    if (cues.length) return { cues, timed: true, format: 'vtt' };
  }
  if (lower.endsWith('.srt') || /-->/.test(trimmed)) {
    const cues = parseCueBlocks(trimmed);
    if (cues.length) return { cues, timed: true, format: 'srt' };
  }
  return { cues: [], timed: false, format: 'text', text: trimmed };
}
