/**
 * Figures for the AI performance hub, from technicians' decisions (pure functions; the queries are in ai.repository.ts).
 *
 * - Confusion matrix: what the model said (columns) against what the technician decided (rows).
 * - Calibration: results grouped by the model's confidence; in each group, how often the model was right. A
 *   well-calibrated model is right about 80% of the time when it says 80%. ECE (expected calibration error) is the
 *   average gap, weighted by group size: 0 is perfect.
 */
import { DAMAGE_LABELS } from '../inspections/inspections.rules.js';
import { SOUND_FAULTS, SOUND_LABELS, SOUND_SITUATIONS, type SoundLabel, type SoundSituation } from '../inspections/inspections.sound.js';

export type CalibrationBin = { from: number; to: number; count: number; meanConfidence: number | null; accuracy: number | null };
export type Calibration = { bins: CalibrationBin[]; ece: number | null; count: number };

const EDGES = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];
const round = (v: number, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

export function calibration(items: { confidence: number; correct: boolean }[]): Calibration {
  const bins = EDGES.slice(0, -1).map((from, i) => {
    const to = EDGES[i + 1]!;
    const mine = items.filter((x) => x.confidence >= from && x.confidence < to);
    return {
      from,
      to: Math.min(to, 1),
      count: mine.length,
      meanConfidence: mine.length ? round(mine.reduce((s, x) => s + x.confidence, 0) / mine.length) : null,
      accuracy: mine.length ? round(mine.filter((x) => x.correct).length / mine.length) : null,
    };
  });
  const n = items.length;
  const ece = n ? round(bins.reduce((s, b) => s + (b.count ? (b.count / n) * Math.abs(b.accuracy! - b.meanConfidence!) : 0), 0)) : null;
  return { bins, ece, count: n };
}

// ---------- sound ----------

export type SoundDecision = {
  situation: SoundSituation;
  label: SoundLabel;            // the model's answer
  finalLabel: SoundLabel | null; // the technician's (null = rejected: not a usable result)
  confidence: number;
  familiar: boolean | null;
};

export function soundFigures(rows: SoundDecision[]) {
  const reviewed = rows.length;
  const correct = rows.filter((r) => r.finalLabel === r.label).length;
  const rejected = rows.filter((r) => r.finalLabel === null).length;
  const situations = SOUND_SITUATIONS.map((situation) => {
    const labels = SOUND_LABELS.filter((l) => SOUND_FAULTS[l].situation === situation);
    const mine = rows.filter((r) => r.situation === situation);
    return {
      situation,
      labels,
      // matrix[true][predicted]; rows only for results the technician kept (confirmed or corrected)
      matrix: labels.map((t) => labels.map((p) => mine.filter((r) => r.finalLabel === t && r.label === p).length)),
      rejected: labels.map((p) => mine.filter((r) => r.finalLabel === null && r.label === p).length),
      reviewed: mine.length,
      correct: mine.filter((r) => r.finalLabel === r.label).length,
    };
  });
  const perFault = SOUND_LABELS.map((label) => {
    const said = rows.filter((r) => r.label === label);
    const truly = rows.filter((r) => r.finalLabel === label);
    const hit = said.filter((r) => r.finalLabel === label).length;
    return {
      label,
      said: said.length,
      truly: truly.length,
      precision: said.length ? round(hit / said.length) : null, // when it says this fault, how often it is right
      recall: truly.length ? round(hit / truly.length) : null, // of the real cases, how many it found
    };
  });
  const unfamiliar = rows.filter((r) => r.familiar === false);
  return {
    reviewed,
    correct,
    corrected: reviewed - correct - rejected,
    rejected,
    accuracy: reviewed ? round(correct / reviewed) : null,
    situations,
    perFault,
    calibration: calibration(rows.map((r) => ({ confidence: r.confidence, correct: r.finalLabel === r.label }))),
    // The odd-sound check in real use: how often flagged recordings turned out wrong vs the others
    familiarity: {
      flagged: unfamiliar.length,
      flaggedWrong: unfamiliar.filter((r) => r.finalLabel !== r.label).length,
      othersWrong: rows.filter((r) => r.familiar === true && r.finalLabel !== r.label).length,
      others: rows.filter((r) => r.familiar === true).length,
    },
  };
}

// ---------- damage ----------

export type DamageDecision = {
  label: string;
  correctedLabel: string | null;
  reviewStatus: string;
  source: string;
  isSuggestion: boolean;
  confidence: number | null;
};

const DAMAGE: string[] = [...DAMAGE_LABELS];

/**
 * Damage confusion: rows = what the technician decided (a damage type, or "not damage" for rejected regions),
 * columns = what the model said (a damage type, or "missed" for damage the technician drew). Suggestions nobody
 * accepted are left out (the model itself was unsure). Calibration from the model's regions only.
 */
export function damageFigures(rows: DamageDecision[]) {
  const model = rows.filter((r) => r.source === 'model' && !(r.isSuggestion && r.reviewStatus === 'rejected'));
  const truthOf = (r: DamageDecision) => (r.reviewStatus === 'rejected' ? 'not_damage' : (r.correctedLabel ?? r.label));
  const truths = [...DAMAGE, 'not_damage'];
  const predicted = [...DAMAGE, 'missed'];
  const matrix = truths.map((t) =>
    predicted.map((p) =>
      p === 'missed'
        ? rows.filter((r) => r.source === 'technician' && r.label === t).length
        : model.filter((r) => r.label === p && truthOf(r) === t).length,
    ),
  );
  return {
    truths,
    predicted,
    matrix,
    calibration: calibration(
      model.filter((r) => r.confidence !== null).map((r) => ({ confidence: Number(r.confidence), correct: truthOf(r) === r.label })),
    ),
  };
}
