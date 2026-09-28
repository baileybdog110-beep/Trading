import type { EvidenceGrade } from '../evidence/types';

/**
 * Evidence categories are an ordinal single-hue ramp (validated: monotone lightness,
 * visible step gaps) plus a separate magenta + stripes for 'contested'.
 * Gray means "no verified association for this segment" - never "inactive".
 * Deliberately NOT a red/yellow "heat" palette, which reads as activation intensity.
 */
export const GRADE_COLORS: Record<'light' | 'dark', Record<EvidenceGrade | 'none', string>> = {
  light: { strong: '#104281', moderate: '#2a78d6', limited: '#86b6ef', contested: '#d55181', none: '#c8ccd2' },
  dark: { strong: '#9ec5f4', moderate: '#3987e5', limited: '#184f95', contested: '#e87ba4', none: '#5a6069' },
};

export const GRADE_LABEL: Record<EvidenceGrade, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  limited: 'Limited evidence',
  contested: 'Contested (conflicting findings)',
};

export const GRADE_SHORT: Record<EvidenceGrade, string> = {
  strong: 'Strong',
  moderate: 'Moderate',
  limited: 'Limited',
  contested: 'Contested',
};

export const APPLICABILITY_LABEL = {
  direct: 'Direct match',
  partial: 'Partial match',
  extrapolation: 'Extrapolation',
} as const;

export function currentTheme(): 'light' | 'dark' {
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
