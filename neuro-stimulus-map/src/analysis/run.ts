/**
 * Browser orchestration of the local analysis. No media is uploaded anywhere:
 * decoding, frame sampling and face detection all run in this tab.
 */
import { newId } from '../util/id';
import type { AnalysisSession, Modalities, TranscriptCue } from '../pipeline/types';
import { analyzeAudioStream, type AudioAnalysis } from './audio/analyze';
import { WHOLE_FILE_WARN_BYTES, WHOLE_FILE_WARN_SECONDS, chooseStrategy, decodeChunks } from './audio/decode';
import { assemble } from './assemble';
import { analyzeVideo, probeVideo } from './video/sample';
import type { VideoAnalysis } from './video/types';

export interface Progress {
  stage: 'probe' | 'audio' | 'video' | 'assemble' | 'done';
  fraction: number;
  note: string;
}

export interface RunOptions {
  faces: boolean;
  cues: TranscriptCue[];
  transcriptTimed: boolean;
  transcriptOrigin?: 'file' | 'local-asr';
  untimedTranscript?: string;
  onProgress: (p: Progress) => void;
  signal: AbortSignal;
}

export const SUPPORTED_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'];

export async function runAnalysis(file: File, url: string, opts: RunOptions): Promise<{ session: AnalysisSession; raw: RawAnalyses }> {
  const notes: string[] = [];
  opts.onProgress({ stage: 'probe', fraction: 0, note: 'Reading file metadata' });
  const probe = await probeVideo(url);
  const duration = probe.duration;
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Could not determine the media duration.');

  const modalities: Modalities = {
    audio: { state: 'not-analyzed', detail: 'Not analysed yet.' },
    video: probe.hasVideo
      ? { state: 'not-analyzed', detail: 'Not analysed yet.' }
      : { state: 'not-present', detail: 'No video track (audio-only file). No visual features are shown or inferred.' },
    faces: { state: 'not-analyzed', detail: probe.hasVideo ? 'Not analysed yet.' : 'No video track.' },
    transcript: opts.cues.length
      ? { state: 'analyzed', detail: `${opts.cues.length} timed transcript cues.`, timed: true, origin: opts.transcriptOrigin ?? 'file' }
      : opts.untimedTranscript
        ? { state: 'analyzed', detail: 'Untimed transcript: words cannot be placed on the timeline, so no per-segment language features are computed.', timed: false, origin: 'file' }
        : { state: 'not-analyzed', detail: 'No transcript provided. Language features (meaning, narrative) are not inferred from audio.' },
  };

  // --- audio ---
  let audio: AudioAnalysis | null = null;
  const strategy = chooseStrategy(file);
  if (strategy === 'whole-file' && (file.size > WHOLE_FILE_WARN_BYTES || duration > WHOLE_FILE_WARN_SECONDS)) {
    notes.push(
      'Long or large non-WAV/MP3 file: the browser decodes its audio in one piece, which may run out of memory (especially on phones and tablets). Converting to MP3 or WAV enables chunked processing.',
    );
  }
  try {
    audio = await analyzeAudioStream(
      decodeChunks(file, strategy),
      (sec) => opts.onProgress({ stage: 'audio', fraction: Math.min(1, sec / duration), note: `Audio: ${Math.round(sec)} / ${Math.round(duration)} s (${strategy === 'whole-file' ? 'decoded in one piece' : 'chunked'})` }),
      opts.signal,
    );
    modalities.audio = {
      state: 'analyzed',
      detail: `Decoded locally at 16 kHz mono (${strategy === 'wav-stream' ? 'streamed WAV' : strategy === 'mp3-chunks' ? 'MP3 decoded in chunks' : 'decoded in one piece by the browser'}).`,
    };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    modalities.audio = {
      state: 'failed',
      detail: `Audio could not be decoded in this browser (${(e as Error).message || 'unknown error'}). The file may have no audio track or use an unsupported codec. No audio features are shown or inferred.`,
    };
  }

  // --- video ---
  let video: VideoAnalysis | null = null;
  if (probe.hasVideo) {
    try {
      video = await analyzeVideo(url, {
        faces: opts.faces,
        signal: opts.signal,
        onProgress: (fr, note) => opts.onProgress({ stage: 'video', fraction: fr, note }),
      });
      modalities.video = { state: 'analyzed', detail: `Sampled ${video.samples.length} frames (every ${video.step} s) at low resolution, locally.` };
      modalities.faces = video.facesAnalyzed
        ? { state: 'analyzed', detail: video.faceNote }
        : { state: opts.faces ? 'failed' : 'not-analyzed', detail: video.faceNote };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      modalities.video = { state: 'failed', detail: `Video frames could not be sampled (${(e as Error).message}). No visual features are shown or inferred.` };
      modalities.faces = { state: 'failed', detail: 'Video was not analysed.' };
    }
  }

  opts.onProgress({ stage: 'assemble', fraction: 1, note: 'Building segments' });
  const { segments, tracks } = assemble({ duration, audio, video, cues: opts.cues });
  opts.onProgress({ stage: 'done', fraction: 1, note: 'Done' });
  return {
    session: {
      id: newId(),
      isDemo: false,
      mediaName: file.name,
      mediaKind: probe.hasVideo ? 'video' : 'audio',
      duration,
      createdAt: new Date().toISOString(),
      modalities,
      segments,
      tracks,
      untimedTranscript: opts.untimedTranscript,
      notes,
    },
    raw: { audio, video },
  };
}

export interface RawAnalyses {
  audio: AudioAnalysis | null;
  video: VideoAnalysis | null;
}

/** Rebuild segments after a transcript arrives (e.g. from local speech recognition). */
export function withTranscript(session: AnalysisSession, raw: RawAnalyses, cues: TranscriptCue[], origin: 'file' | 'local-asr'): AnalysisSession {
  const { segments, tracks } = assemble({ duration: session.duration, audio: raw.audio, video: raw.video, cues });
  return {
    ...session,
    segments,
    tracks,
    untimedTranscript: undefined,
    modalities: {
      ...session.modalities,
      transcript: {
        state: 'analyzed',
        detail: origin === 'local-asr' ? `${cues.length} cues from local speech recognition (Whisper, in-browser). Automatic transcripts contain errors.` : `${cues.length} timed transcript cues.`,
        timed: true,
        origin,
      },
    },
  };
}

/**
 * Transcript-only analysis: no audio or video is available, so only language features
 * are computed and every other modality is reported as not analysed.
 */
export function runTranscriptOnly(name: string, cues: TranscriptCue[]): AnalysisSession {
  const duration = Math.max(1, ...cues.map((c) => c.end)) + 1;
  const { segments, tracks } = assemble({ duration, audio: null, video: null, cues });
  return {
    id: newId(),
    isDemo: false,
    mediaName: name,
    mediaKind: 'none',
    duration,
    createdAt: new Date().toISOString(),
    modalities: {
      audio: { state: 'not-analyzed', detail: 'Transcript only: no audio was provided, so no acoustic features (speech sound, music, loudness, onsets) were measured.' },
      video: { state: 'not-analyzed', detail: 'Transcript only: no video was provided or analysed.' },
      faces: { state: 'not-analyzed', detail: 'Transcript only.' },
      transcript: { state: 'analyzed', detail: `${cues.length} timed cues from the transcript file.`, timed: true, origin: 'file' },
    },
    segments,
    tracks,
    notes: ['Only the transcript was analysed. Speech presence is inferred from transcript timestamps, not from audio.'],
  };
}
