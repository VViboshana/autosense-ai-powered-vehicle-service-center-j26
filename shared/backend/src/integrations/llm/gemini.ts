import { z } from 'zod';
import { ServiceUnavailableError } from '../../http/errors.js';

/**
 * Client for Google's Gemini API (generateContent), used to reword confirmed report facts for customers
 * (modules/my/my.summary.ts). Only text goes out, never photos or personal data. The key is sent in a header, never in
 * the URL, so it does not end up in logs. Failures become a 503; the caller falls back to its own template.
 */
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const response = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })).default([]) }).optional() }))
    .default([]),
});

export type GeminiSettings = { apiKey: string | undefined; model: string; timeoutMs?: number };

export async function generateText(settings: GeminiSettings, prompt: { system: string; user: string }): Promise<string> {
  if (!settings.apiKey) throw new ServiceUnavailableError('LLM_NOT_CONFIGURED', 'The AI writer is not set up (GEMINI_API_KEY).');

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/models/${encodeURIComponent(settings.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      }),
      signal: AbortSignal.timeout(settings.timeoutMs ?? 20_000),
    });
  } catch {
    throw new ServiceUnavailableError('LLM_UNAVAILABLE', 'The AI writer is not responding.');
  }
  // 429: over the free tier's limit; 5xx: Google's side is busy. Either way the caller uses its template.
  if (!res.ok) throw new ServiceUnavailableError('LLM_UNAVAILABLE', `The AI writer answered ${res.status}.`);

  const parsed = response.safeParse(await res.json().catch(() => null));
  const text = parsed.success ? parsed.data.candidates[0]?.content?.parts.map((p) => p.text ?? '').join('').trim() : '';
  if (!text) throw new ServiceUnavailableError('LLM_BAD_RESPONSE', 'The AI writer sent an empty answer.');
  return text;
}
