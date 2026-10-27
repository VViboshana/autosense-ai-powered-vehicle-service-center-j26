import { createHash } from 'node:crypto';
import type { Db } from '../../db/pool.js';
import { generateText, type GeminiSettings } from '../../integrations/llm/gemini.js';
import { logger } from '../../lib/logger.js';
import type { Priority } from '../inspections/inspections.repair.js';

/**
 * The "In plain words" summary at the top of a customer's inspection report (summary-v0).
 *
 * Our models and the technician decide what is wrong; this only retells those confirmed facts. The facts come from the
 * same customer-safe report the page shows (confirmed or corrected areas and sounds, the repair guide), and carry no
 * personal data: no name, number plate, photo or technician's note. A language model (Gemini) may reword them in
 * English, Sinhala or Tamil; when it is not set up or fails, templateSummary writes a simple English version from the
 * same facts, so the report never depends on an outside service.
 */
export const SUMMARY_METHOD = 'summary-v0';
export const SUMMARY_LANGUAGES = ['en', 'si', 'ta'] as const;
export type SummaryLanguage = (typeof SUMMARY_LANGUAGES)[number];

const LANGUAGE_NAMES: Record<SummaryLanguage, string> = { en: 'English', si: 'Sinhala', ta: 'Tamil' };

// The customer words for each value, as on the report page (frontend/src/modules/customer/customer.ui.ts)
const DAMAGE_NAMES: Record<string, string> = {
  dent: 'Dent', scratch: 'Scratch', crack: 'Crack', glass_shatter: 'Shattered glass', lamp_broken: 'Broken lamp', tire_flat: 'Flat tyre',
};
const SEVERITY_NAMES: Record<string, string> = { minor: 'Minor', moderate: 'Moderate', severe: 'Severe' };
const PRIORITY_NAMES: Record<Priority, string> = {
  before_driving: 'Fix before driving', soon: 'Fix soon', planned: 'Book a repair', cosmetic: 'Cosmetic',
};
const PRIORITY_ORDER: Priority[] = ['before_driving', 'soon', 'planned', 'cosmetic'];

/** Estimated workshop hours in rough words, never exact hours (the same steps as roughTime on the report page). */
export function roughTime(range: [number, number] | null) {
  if (!range) return 'time to be confirmed';
  const most = range[1];
  if (most <= 1) return 'under an hour';
  if (most <= 4) return 'a few hours';
  if (most <= 8) return 'about a day';
  if (most <= 16) return 'about two days';
  return 'several days';
}

type Hours = [number, number];

/** The parts of a confirmed customer report (my.routes.ts confirmedInspections) the summary is made from. */
export type SummaryReport = {
  overallSeverity: string | null;
  areas: { label: string; severity: string | null; where: string; repair: { priority: Priority; why: string } }[];
  repair: { priority: Priority | null; services: { name: string; areas: number; effortHours: Hours | null }[]; effortHours: Hours | null };
  sounds: { situation: string; name: string; advice: string; normal: boolean }[];
  mechanical: { items: { name: string; priority: Priority; why: string }[]; services: { name: string }[]; effortHours: Hours | null };
};

export type SummaryFacts = {
  overallSeverity: string | null;
  mostUrgent: string | null;
  damage: { damage: string; where: string; severity: string; priority: string; why: string }[];
  bodyWork: { service: string; areas: number; time: string }[];
  bodyWorkTime: string | null;
  sounds: { when: string; heard: string; normal: boolean; advice: string | null }[];
  mechanicalWork: { fault: string; priority: string; why: string }[];
  mechanicalTime: string | null;
};

/** Plain facts in customer words, most urgent damage first. Everything else in the report is left out. */
export function summaryFacts(report: SummaryReport): SummaryFacts {
  const urgent = [report.repair.priority, ...report.mechanical.items.map((i) => i.priority)]
    .filter((p): p is Priority => p !== null)
    .sort((a, b) => PRIORITY_ORDER.indexOf(a) - PRIORITY_ORDER.indexOf(b))[0];
  return {
    overallSeverity: report.overallSeverity && SEVERITY_NAMES[report.overallSeverity] ? SEVERITY_NAMES[report.overallSeverity]! : null,
    mostUrgent: urgent ? PRIORITY_NAMES[urgent] : null,
    damage: [...report.areas]
      .sort((a, b) => PRIORITY_ORDER.indexOf(a.repair.priority) - PRIORITY_ORDER.indexOf(b.repair.priority))
      .map((a) => ({
        damage: DAMAGE_NAMES[a.label] ?? a.label,
        where: a.where,
        severity: (a.severity && SEVERITY_NAMES[a.severity]) || 'Not graded',
        priority: PRIORITY_NAMES[a.repair.priority],
        why: a.repair.why,
      })),
    bodyWork: report.repair.services.map((s) => ({ service: s.name, areas: s.areas, time: roughTime(s.effortHours) })),
    bodyWorkTime: report.repair.services.length ? roughTime(report.repair.effortHours) : null,
    sounds: report.sounds.map((s) => ({ when: s.situation, heard: s.name, normal: s.normal, advice: s.normal ? null : s.advice })),
    mechanicalWork: report.mechanical.items.map((i) => ({ fault: i.name, priority: PRIORITY_NAMES[i.priority], why: i.why })),
    mechanicalTime: report.mechanical.items.length ? roughTime(report.mechanical.effortHours) : null,
  };
}

/** Identifies the facts a stored summary was written from: a summary is reused only while its facts are unchanged. */
export const factsHash = (facts: SummaryFacts) => createHash('sha256').update(JSON.stringify(facts)).digest('hex');

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The simple English summary, written from the facts by fixed rules (no outside service). */
export function templateSummary(f: SummaryFacts): string {
  const out: string[] = [];
  const urgentDamage = f.damage.filter((d) => d.priority === PRIORITY_NAMES.before_driving);
  const urgentSounds = f.mechanicalWork.filter((m) => m.priority === PRIORITY_NAMES.before_driving);

  if (f.damage.length === 0) out.push('We found no damage on your vehicle.');
  else {
    out.push(`We found ${f.damage.length === 1 ? 'one damaged area' : `${f.damage.length} damaged areas`} on your vehicle${f.overallSeverity ? ` (overall: ${lower(f.overallSeverity)})` : ''}.`);
    if (urgentDamage.length) {
      out.push(`Please have the ${list(urgentDamage.map((d) => `${lower(d.damage)} (${lower(d.where)})`))} fixed before you drive the car again.`);
    }
    const rest = f.damage.filter((d) => !urgentDamage.includes(d));
    if (rest.length) out.push(`${urgentDamage.length ? 'The rest' : 'What we found'}: ${list(rest.map((d) => `${lower(d.damage)} (${lower(d.where)}, ${lower(d.priority)})`))}.`);
  }

  const faults = f.sounds.filter((s) => !s.normal);
  if (f.sounds.length && !faults.length) out.push('Your vehicle sounded normal when we checked it.');
  if (faults.length) {
    out.push(`When we listened to the vehicle, we heard ${list(faults.map((s) => lower(s.heard)))}${urgentSounds.length ? '; please have this checked before driving' : '; a mechanic should take a look'}.`);
  }

  const time = [f.bodyWorkTime, f.mechanicalTime].filter((t): t is string => t !== null);
  if (f.bodyWork.length) out.push(`The repairs would take ${f.bodyWorkTime}${f.mechanicalWork.length && f.mechanicalTime ? `, plus ${f.mechanicalTime} of mechanical work` : ''} at the workshop.`);
  else if (time.length) out.push(`The mechanical work would take ${time[0]} at the workshop.`);
  if (f.damage.length || faults.length) out.push('The service centre will confirm the work and the cost with you.');
  return out.join(' ');
}

/** What the language model is told: its job, the rules it must keep, and the facts as data. */
export function summaryPrompt(facts: SummaryFacts, language: SummaryLanguage) {
  const system = [
    'You write a short summary of a vehicle inspection report for the vehicle owner, at a service centre in Sri Lanka.',
    'The facts were confirmed by a technician. Retell ONLY these facts. Do not add causes, prices, costs, exact hours, brands or advice that is not in the facts.',
    `Write in ${LANGUAGE_NAMES[language]}, in simple everyday words a non-expert understands. Speak to the owner as "you".`,
    language === 'en' ? '' : `Use natural, polite written ${LANGUAGE_NAMES[language]}. You may put a part or fault name in English in brackets when the ${LANGUAGE_NAMES[language]} word is not common.`,
    'Start with anything marked "Fix before driving", clearly. Then the rest, briefly. Mention the rough time if it is given, in the same rough words.',
    'End by saying the service centre will confirm the work and the cost.',
    '3 to 5 sentences. Plain text only: no headings, lists, markdown or emojis.',
  ].filter(Boolean).join('\n');
  return { system, user: `Inspection facts (JSON):\n${JSON.stringify(facts, null, 2)}` };
}

export type ReportSummary = {
  /** The language of the text: English when the AI writer could not write the one asked for */
  language: SummaryLanguage;
  requested: SummaryLanguage;
  /** ai: reworded by the language model; template: written by fixed rules */
  source: 'ai' | 'template';
  model: string | null;
  method: string;
  text: string;
};

/**
 * The summary of one confirmed report in a language: the stored one while its facts are unchanged, else a new one from
 * the language model (then stored), else the English template. Never fails because of the outside service.
 */
export async function reportSummary(
  db: Db,
  writer: GeminiSettings,
  inspectionId: number,
  report: SummaryReport,
  language: SummaryLanguage,
): Promise<ReportSummary> {
  const facts = summaryFacts(report);
  const hash = factsHash(facts);
  const base = { requested: language, method: SUMMARY_METHOD };

  const stored = await db.query<{ summary: string; model: string }>(
    'SELECT summary, model FROM damage.report_summaries WHERE inspection_id = $1 AND language = $2 AND facts_hash = $3',
    [inspectionId, language, hash],
  );
  if (stored.rows[0]) return { ...base, language, source: 'ai', model: stored.rows[0].model, text: stored.rows[0].summary };

  if (writer.apiKey) {
    try {
      const text = cleanSummary(await generateText(writer, summaryPrompt(facts, language)));
      if (text) {
        await db.query(
          `INSERT INTO damage.report_summaries (inspection_id, language, facts_hash, model, method, summary)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (inspection_id, language) DO UPDATE
             SET facts_hash = EXCLUDED.facts_hash, model = EXCLUDED.model, method = EXCLUDED.method,
                 summary = EXCLUDED.summary, created_at = now()`,
          [inspectionId, language, hash, writer.model, SUMMARY_METHOD, text],
        );
        return { ...base, language, source: 'ai', model: writer.model, text };
      }
      logger.warn('Report summary: the AI writer\'s text was not fit to show; using the template', { inspectionId, language });
    } catch (err) {
      logger.warn('Report summary: the AI writer failed; using the template', { inspectionId, language, error: (err as Error).message });
    }
  }
  return { ...base, language: 'en', source: 'template', model: null, text: templateSummary(facts) };
}

/**
 * A price in any of the three languages: the summary must never quote one. The rupee marks (රු, ரூ) count only before
 * an amount, because the same letters appear in ordinary words (e.g. කරුණාකර, "please").
 */
const MONEY = /(\bRs\.?\s?\d|\bLKR\b|\brupees?\b|\$\s?\d|රු\.?\s?\d|රුපියල්|ரூ\.?\s?\d|ரூபாய்)/i;

/**
 * The model's text when it is fit to show, otherwise null (the caller then uses the template): not empty, not too
 * long, and without prices. Markdown it may still add is removed.
 */
export function cleanSummary(text: string | null | undefined): string | null {
  if (!text) return null;
  const clean = text.replace(/[*#_`]/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length < 20 || clean.length > 1500 || MONEY.test(clean)) return null;
  return clean;
}
