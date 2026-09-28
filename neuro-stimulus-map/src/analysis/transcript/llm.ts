/**
 * OPTIONAL: ask Claude to *suggest* interpretive labels for transcript segments.
 *
 * Boundaries enforced here and in the mapping engine:
 *  - Only transcript text and segment times are sent (never audio or video), and only after
 *    the user has read the disclosure and entered their own API key.
 *  - The model chooses from a fixed label vocabulary; it is told not to discuss the brain.
 *  - Every suggestion becomes a feature with status 'suggested', which the mapping engine
 *    ignores until a person confirms it. Brain mappings still come only from the curated
 *    evidence database.
 */
import { z } from 'zod';
import type { DetectedFeature, Segment } from '../../pipeline/types';

export const LLM_MODEL = 'claude-opus-5';
export const LLM_LABELS = ['humor', 'suspense', 'surprise', 'emotional_theme', 'situation_change'] as const;

const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      segmentId: z.string(),
      label: z.enum(LLM_LABELS),
      quote: z.string(),
      rationale: z.string(),
    }),
  ),
});
export type LlmSuggestion = z.infer<typeof SuggestionSchema>['suggestions'][number];

const SYSTEM = `You help people annotate media transcripts for an educational tool.
For each segment you receive, decide whether any of these interpretive labels plausibly applies to the CONTENT (not to any listener's feelings):
- humor: a joke, comic incongruity or clearly humorous exchange
- suspense: an uncertain outcome that the narrative makes the audience care about
- surprise: an unexpected turn in the content
- emotional_theme: content that is explicitly about an emotional situation
- situation_change: a change of time, place, topic or main action
Only suggest a label when the transcript text supports it; include a short verbatim quote from that segment and a one-sentence rationale.
Never mention brains, neurons, hormones, neurotransmitters or what a listener will feel. These are suggestions a person will review.`;

export async function suggestInterpretations(
  apiKey: string,
  segments: Segment[],
  onProgress: (note: string) => void,
  signal: AbortSignal,
): Promise<LlmSuggestion[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
  // The key stays in memory for this request only; it is never stored.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const withText = segments.filter((s) => s.cues.length);
  const batches: Segment[][] = [];
  let cur: Segment[] = [];
  let chars = 0;
  for (const s of withText) {
    const len = s.cues.reduce((n, c) => n + c.text.length, 0);
    if (cur.length && chars + len > 40000) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(s);
    chars += len;
  }
  if (cur.length) batches.push(cur);

  const valid = new Map(segments.map((s) => [s.id, s]));
  const out: LlmSuggestion[] = [];
  for (let i = 0; i < batches.length; i++) {
    onProgress(`Sending transcript batch ${i + 1} of ${batches.length} to the Anthropic API`);
    const payload = batches[i].map((s) => ({ segmentId: s.id, start: +s.start.toFixed(1), end: +s.end.toFixed(1), text: s.cues.map((c) => c.text).join(' ') }));
    const response = await client.beta.messages.parse(
      {
        model: LLM_MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{ role: 'user', content: `Segments (JSON):\n${JSON.stringify(payload)}` }],
        output_config: { format: betaZodOutputFormat(SuggestionSchema) },
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('The model declined this request; no suggestions were produced.');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('The response could not be parsed; no suggestions were produced.');
    for (const s of parsed.suggestions) {
      const seg = valid.get(s.segmentId);
      // Keep only suggestions whose quote actually occurs in that segment's transcript.
      const text = seg?.cues.map((c) => c.text).join(' ').toLowerCase() ?? '';
      if (seg && s.quote.trim() && text.includes(s.quote.trim().toLowerCase().slice(0, 40))) out.push(s);
    }
  }
  return out;
}

export function suggestionToFeature(s: LlmSuggestion): DetectedFeature {
  return {
    id: s.label,
    present: true,
    confidence: 'low',
    status: 'suggested',
    source: 'llm',
    measurement: `Suggested by ${LLM_MODEL}: "${s.quote}" - ${s.rationale} (interpretation; confirm or reject).`,
  };
}
