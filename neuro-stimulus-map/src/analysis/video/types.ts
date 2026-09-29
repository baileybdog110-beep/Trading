export interface VideoSample {
  t: number;
  luma: number;
  /** histogram distance to previous sample */
  histDist: number;
  /** motion speed estimate in summary-frame widths per second (0 for first sample) */
  motion: number;
  /** residual difference after global motion compensation */
  residual: number;
  /** fraction of pixels changed after global motion compensation */
  changed: number;
  /** faces found (null when not checked for this sample) */
  faces: number | null;
  /** largest face area as fraction of frame (null when not checked) */
  faceArea: number | null;
  /** mean colour saturation 0..1 */
  sat?: number;
  /** expression shown on the largest face, by the local expression model (null when not checked or no face) */
  expr?: Partial<Record<'neutral' | 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised', number>> | null;
}

export interface VideoAnalysis {
  duration: number;
  step: number;
  width: number;
  height: number;
  samples: VideoSample[];
  cuts: number[];
  /** brief full-frame flashes (jump away and back); treated as brightness changes, not cuts */
  flashes: number[];
  facesAnalyzed: boolean;
  faceNote: string;
}
