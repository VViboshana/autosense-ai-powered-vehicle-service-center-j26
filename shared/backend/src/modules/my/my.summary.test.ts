import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/pool.js';
import { cleanSummary, factsHash, reportSummary, roughTime, summaryFacts, summaryPrompt, templateSummary, type SummaryReport } from './my.summary.js';

const noMechanical: SummaryReport['mechanical'] = { items: [], services: [], effortHours: null };

const report: SummaryReport = {
  overallSeverity: 'severe',
  areas: [
    { label: 'dent', severity: 'moderate', where: 'Front bumper, left side', repair: { priority: 'planned', why: 'Visible damage that needs repair; it can be booked in.' } },
    { label: 'glass_shatter', severity: 'severe', where: 'Windscreen', repair: { priority: 'before_driving', why: 'Shattered glass affects visibility.' } },
  ],
  repair: {
    priority: 'before_driving',
    services: [
      { name: 'Glass replacement', areas: 1, effortHours: [1.5, 3] },
      { name: 'Body repair', areas: 1, effortHours: [1.5, 3] },
    ],
    effortHours: [3, 6],
  },
  sounds: [
    { situation: 'starting', name: 'Normal start', advice: 'No starting problem heard.', normal: true },
    { situation: 'braking', name: 'Worn brakes', advice: 'Inspect brake pads and discs.', normal: false },
  ],
  mechanical: { items: [{ name: 'Worn brakes', priority: 'soon', why: 'Worn brakes make stopping distances longer.' }], services: [{ name: 'Brake service' }], effortHours: [1, 2] },
};

const clean: SummaryReport = { overallSeverity: null, areas: [], repair: { priority: null, services: [], effortHours: null }, sounds: [], mechanical: noMechanical };

describe('summary facts', () => {
  it('lists the damage most urgent first, in customer words', () => {
    const f = summaryFacts(report);
    expect(f.mostUrgent).toBe('Fix before driving');
    expect(f.overallSeverity).toBe('Severe');
    expect(f.damage.map((d) => d.damage)).toEqual(['Shattered glass', 'Dent']);
    expect(f.bodyWorkTime).toBe('about a day');
    expect(f.sounds[0]).toEqual({ when: 'starting', heard: 'Normal start', normal: true, advice: null });
  });

  it('never carries exact hours or anything outside the report facts', () => {
    const text = JSON.stringify(summaryFacts(report));
    expect(text).not.toMatch(/\d\.\d|effortHours/);
  });

  it('gives the same hash for the same facts and a new one when they change', () => {
    expect(factsHash(summaryFacts(report))).toBe(factsHash(summaryFacts(structuredClone(report))));
    expect(factsHash(summaryFacts(report))).not.toBe(factsHash(summaryFacts(clean)));
  });

  it('uses the report page\'s rough time words', () => {
    expect([roughTime(null), roughTime([0.5, 1]), roughTime([1, 4]), roughTime([4, 8]), roughTime([8, 16]), roughTime([10, 20])])
      .toEqual(['time to be confirmed', 'under an hour', 'a few hours', 'about a day', 'about two days', 'several days']);
  });
});

describe('template summary', () => {
  it('puts the before-driving damage first, then the rest, sounds, time and the confirmation line', () => {
    expect(templateSummary(summaryFacts(report))).toBe(
      'We found 2 damaged areas on your vehicle (overall: severe). Please have the shattered glass (windscreen) fixed before you drive the car again. '
      + 'The rest: dent (front bumper, left side, book a repair). When we listened to the vehicle, we heard worn brakes; a mechanic should take a look. '
      + 'The repairs would take about a day, plus a few hours of mechanical work at the workshop. The service centre will confirm the work and the cost with you.',
    );
  });

  it('says so plainly when nothing was found', () => {
    expect(templateSummary(summaryFacts(clean))).toBe('We found no damage on your vehicle.');
    const quiet = { ...clean, sounds: [{ situation: 'idling', name: 'Normal idle', advice: '', normal: true }] };
    expect(templateSummary(summaryFacts(quiet))).toBe('We found no damage on your vehicle. Your vehicle sounded normal when we checked it.');
  });
});

describe('prompt and checks on the model\'s text', () => {
  it('asks for the chosen language and forbids prices', () => {
    const p = summaryPrompt(summaryFacts(report), 'si');
    expect(p.system).toContain('Write in Sinhala');
    expect(p.system).toMatch(/Do not add causes, prices/);
    expect(p.user).toContain('"damage": "Shattered glass"');
  });

  it('removes markdown and refuses empty, too long or priced text', () => {
    expect(cleanSummary('**Your car** has  a dent.\nPlease book a repair.')).toBe('Your car has a dent. Please book a repair.');
    expect(cleanSummary('')).toBeNull();
    expect(cleanSummary('x'.repeat(1600))).toBeNull();
    expect(cleanSummary('The repair will cost about Rs 25,000 at the workshop.')).toBeNull();
    expect(cleanSummary('ඔබේ වාහනය අලුත්වැඩියාවට රු. 25000 ක් වැය වේ.')).toBeNull();
    expect(cleanSummary('பழுதுபார்க்க ரூ. 15000 செலவாகும் என்று எதிர்பார்க்கப்படுகிறது.')).toBeNull();
  });

  it('keeps ordinary Sinhala and Tamil words that contain the rupee letters', () => {
    expect(cleanSummary('කරුණාකර ධාවනය කිරීමට පෙර ඉදිරිපස වීදුරුව අලුත්වැඩියා කරගන්න.')).not.toBeNull();
    expect(cleanSummary('உங்கள் வாகனத்தின் முன் கண்ணாடி உடைந்துள்ளது, உருவான சேதத்தை சரிசெய்யவும்.')).not.toBeNull();
  });
});

/** A fake database holding report_summaries rows in memory. */
function fakeDb(rows: { summary: string; model: string; facts_hash: string }[] = []) {
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.startsWith('SELECT')) return { rows: rows.filter((r) => r.facts_hash === params[2]) };
    rows.push({ summary: params[5] as string, model: params[3] as string, facts_hash: params[2] as string });
    return { rows: [] };
  });
  return { db: { query } as unknown as Db, query, rows };
}

const gemini = (text: string, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status }));
const writer = { apiKey: 'test-key-123456', model: 'gemini-test' };
const sinhala = 'ඔබේ වාහනයේ ඉදිරිපස වීදුරුව බිඳී ඇත. කරුණාකර නැවත ධාවනය කිරීමට පෙර එය අලුත්වැඩියා කරගන්න.';

describe('report summary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the English template, without calling out, when no key is set', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { db } = fakeDb();
    const out = await reportSummary(db, { apiKey: undefined, model: 'gemini-test' }, 7, report, 'si');
    expect(out).toMatchObject({ source: 'template', language: 'en', requested: 'si', model: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks the model, stores its text, and reuses it the next time', async () => {
    const fetchMock = gemini(sinhala);
    vi.stubGlobal('fetch', fetchMock);
    const { db, rows } = fakeDb();
    const first = await reportSummary(db, writer, 7, report, 'si');
    expect(first).toMatchObject({ source: 'ai', language: 'si', model: 'gemini-test', text: sinhala });
    expect(rows).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-test:generateContent');
    expect(url).not.toContain('test-key'); // the key goes in a header, never the URL
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key-123456');

    const again = await reportSummary(db, writer, 7, report, 'si');
    expect(again.text).toBe(sinhala);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('writes a new summary when the report facts changed', async () => {
    vi.stubGlobal('fetch', gemini(sinhala));
    const { db } = fakeDb([{ summary: 'old text', model: 'gemini-test', facts_hash: 'stale' }]);
    expect((await reportSummary(db, writer, 7, report, 'si')).text).toBe(sinhala);
  });

  it.each([
    ['over the free limit (429)', gemini('', 429)],
    ['down (503)', gemini('', 503)],
    ['unreachable', vi.fn(async () => { throw new TypeError('fetch failed'); })],
    ['quoting a price', gemini('Fixing the windscreen will cost LKR 40,000 and take a day.')],
  ])('falls back to the template when the model is %s, and stores nothing', async (_why, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock);
    const { db, rows } = fakeDb();
    const out = await reportSummary(db, writer, 7, report, 'ta');
    expect(out).toMatchObject({ source: 'template', language: 'en', requested: 'ta' });
    expect(out.text).toContain('shattered glass');
    expect(rows).toHaveLength(0);
  });
});
