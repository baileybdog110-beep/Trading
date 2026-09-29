/**
 * Emotion cues from the picture. Unlike the sound model, these could not be checked against viewer
 * ratings here (the rated film datasets are not reachable from this project), so they are research-based
 * rules with deliberately small weights, and the app labels them as such.
 *  - Colour: brighter scenes are rated more pleasant, more saturated ones more arousing
 *    (Valdez & Mehrabian 1994: pleasure = .69 brightness + .22 saturation; arousal = -.31 brightness + .60 saturation).
 *  - Motion and cutting pace raise arousal (Hanjalic & Xu 2005).
 *  - Faces: the expression shown on the largest face, placed on the circumplex (Russell 1980). This is what
 *    a viewer sees, not what the person on screen feels (Barrett et al. 2019); seeing fearful or angry faces
 *    engages the amygdala (Fusar-Poli et al. 2009).
 */
import type { VideoAnalysis } from '../analysis/video/types';

/** Approximate circumplex positions (valence, arousal) of the expression categories. */
export const EXPRESSION_VA: Record<string, [number, number]> = {
  neutral: [0, 0],
  happy: [0.8, 0.5],
  surprised: [0.2, 0.8],
  angry: [-0.6, 0.7],
  fearful: [-0.6, 0.6],
  disgusted: [-0.6, 0.3],
  sad: [-0.7, -0.4],
};

export interface VisualTimeline {
  valence: number[];
  arousal: number[];
  /** strongest expression on the largest face (null when no face was checked or found) */
  face: ({ expr: string; p: number; area: number } | null)[];
  /** 0..1: fearful or angry face, weighted by how much of the frame it fills */
  threatFace: number[];
  brightness: number[];
  saturation: number[];
  motion: number[];
}

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

export function visualEmotion(video: VideoAnalysis, n: number, step: number): VisualTimeline {
  const S = video.samples;
  const out: VisualTimeline = { valence: [], arousal: [], face: [], threatFace: [], brightness: [], saturation: [], motion: [] };
  let j = 0;
  let lastFace: { t: number; expr: NonNullable<(typeof S)[number]['expr']>; area: number } | null = null;
  let lastFaceCheck = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = i * step;
    while (j + 1 < S.length && S[j + 1].t <= t) {
      j++;
      if (S[j].faces !== null) {
        lastFaceCheck = S[j].t;
        lastFace = S[j].expr && (S[j].faceArea ?? 0) > 0 ? { t: S[j].t, expr: S[j].expr!, area: S[j].faceArea ?? 0 } : null;
      }
    }
    const s = S[j];
    if (!s) {
      out.valence.push(0);
      out.arousal.push(0);
      out.face.push(null);
      out.threatFace.push(0);
      out.brightness.push(0);
      out.saturation.push(0);
      out.motion.push(0);
      continue;
    }
    if (j === 0 && s.faces !== null) {
      lastFaceCheck = s.t;
      lastFace = s.expr && (s.faceArea ?? 0) > 0 ? { t: s.t, expr: s.expr, area: s.faceArea ?? 0 } : null;
    }
    const zB = clamp((s.luma - 0.42) / 0.18, -2.5, 2.5);
    const zS = clamp(((s.sat ?? 0.3) - 0.3) / 0.15, -2.5, 2.5);
    let v = 0.06 * (0.69 * zB + 0.22 * zS);
    let a = 0.06 * (-0.31 * zB + 0.6 * zS);
    a += 0.3 * clamp(s.motion / 0.6, 0, 1) - 0.08;
    a += 0.06 * Math.min(3, video.cuts.filter((c) => c <= t && c > t - 4).length);
    let face: VisualTimeline['face'][number] = null;
    let threat = 0;
    if (lastFace && t - lastFaceCheck < 1.6) {
      const w = clamp(lastFace.area / 0.04, 0, 1);
      let fv = 0;
      let fa = 0;
      let best = 'neutral';
      let bp = -1;
      for (const [e, p] of Object.entries(lastFace.expr)) {
        const [ev, ea] = EXPRESSION_VA[e] ?? [0, 0];
        fv += (p ?? 0) * ev;
        fa += (p ?? 0) * ea;
        if ((p ?? 0) > bp) [best, bp] = [e, p ?? 0];
      }
      v += 0.5 * w * fv;
      a += 0.5 * w * fa;
      threat = w * ((lastFace.expr.fearful ?? 0) + (lastFace.expr.angry ?? 0));
      face = { expr: best, p: bp, area: lastFace.area };
    }
    out.valence.push(v);
    out.arousal.push(a);
    out.face.push(face);
    out.threatFace.push(clamp(threat, 0, 1));
    out.brightness.push(s.luma);
    out.saturation.push(s.sat ?? 0);
    out.motion.push(s.motion);
  }
  return out;
}
