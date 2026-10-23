/** Shapes returned by /api/ai (backend/src/modules/ai). */
import type { SoundLabel, SoundSituation } from '@/modules/inspections/inspections.types';

export type Score = { clips: number; accuracy: number; macroF1: number } | null;
export type VersionReport = {
  versionNo: number;
  version: string;
  recipe: string;
  trained: string;
  trainedOn: Record<string, number>;
  appRecordings: number;
  runId?: string | null;
  /** Fair test on the same folds: 'current' = without the app's recordings, 'new' = with them */
  comparison: Record<'current' | 'new', Record<'all' | 'noisy' | 'appRecordings', Score>>;
  familiarity: { marginThreshold: number; distanceThreshold: number };
};

export type TrainingRun = {
  runId: string;
  state: 'running' | 'done' | 'failed';
  appRecordings: number;
  versionNo: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  startedBy: string | null;
};

export type Overview = {
  damage: { testSet: { version: string; mask: { mAP50_95: number; precision: number; recall: number }; images: number } | null };
  sound: { serving: { version: string; versionNo: number; trained: string }; active: VersionReport | null; versions: number; running: string | null } | null;
  soundProblem: string | null;
  learning: {
    sound: { learnable: number; corrected: number; inActiveModel: number };
    damage: { photos: number; corrected: number; missed: number; falseAlarms: number };
  };
  runs: TrainingRun[];
};

export type ActivityItem = {
  at: string;
  kind: 'analysed' | 'heard' | 'sound_review' | 'region_review' | 'missed' | 'training';
  inspectionId: number | null;
  inspectionNo: string | null;
  registrationNo: string | null;
  detail: Record<string, unknown>;
  who: string | null;
};

export type CalibrationBin = { from: number; to: number; count: number; meanConfidence: number | null; accuracy: number | null };
export type Calibration = { bins: CalibrationBin[]; ece: number | null; count: number };

export type SoundPerformance = {
  reviewed: number;
  correct: number;
  corrected: number;
  rejected: number;
  accuracy: number | null;
  situations: { situation: SoundSituation; labels: SoundLabel[]; matrix: number[][]; rejected: number[]; reviewed: number; correct: number }[];
  perFault: { label: SoundLabel; said: number; truly: number; precision: number | null; recall: number | null }[];
  calibration: Calibration;
  familiarity: { flagged: number; flaggedWrong: number; othersWrong: number; others: number };
  testSet: ({ version: string } & Record<'all' | 'noisy' | 'appRecordings', Score>) | null;
};

export type DamageInsights = { truths: string[]; predicted: string[]; matrix: number[][]; calibration: Calibration };

export type SoundVersions = {
  active: number;
  running: string | null;
  versions: VersionReport[];
  serving: { version: string; versionNo: number };
  runs: TrainingRun[];
};

export type TrainingStatus = {
  state: 'running' | 'done' | 'failed';
  stage: 'collect' | 'fingerprint' | 'compare' | 'train' | 'done';
  progress: number;
  message: string;
  result: VersionReport | null;
  error: string | null;
};

export type LabRunSummary = { labRunId: number; name: string; modelVersion: string; createdAt: string; createdBy: string | null; items: number; correct: number };
export type LabRun = Omit<LabRunSummary, 'items' | 'correct'> & {
  items: {
    labItemId: number;
    filename: string;
    url: string;
    situation: SoundSituation;
    trueLabel: SoundLabel;
    predictedLabel: SoundLabel | null;
    confidence: number | null;
    sure: boolean | null;
    familiar: boolean | null;
    quality: { warnings?: string[] };
  }[];
};
