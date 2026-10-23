/**
 * Sound inspection faults: the same classes, situations and wording as member-2-damage-assessment/acoustic/classes.py
 * and the CHECK lists in damage.sound_checks. The technician picks the situation; the model and any correction can
 * only name a fault of that situation.
 */
export const SOUND_SITUATIONS = ['starting', 'idling', 'braking'] as const;
export type SoundSituation = (typeof SOUND_SITUATIONS)[number];

export const SOUND_FAULTS = {
  normal_start: { situation: 'starting', name: 'Normal start', advice: 'No starting problem heard.', normal: true },
  bad_ignition: { situation: 'starting', name: 'Ignition problem', advice: 'Check spark plugs, ignition coils and the starter motor.', normal: false },
  dead_battery: { situation: 'starting', name: 'Weak or flat battery', advice: 'Test the battery voltage and charging system.', normal: false },
  normal_idle: { situation: 'idling', name: 'Normal idle', advice: 'No engine problem heard at idle.', normal: true },
  low_oil: { situation: 'idling', name: 'Low engine oil', advice: 'Check the oil level and look for leaks.', normal: false },
  power_steering: { situation: 'idling', name: 'Power steering noise', advice: 'Check the power steering fluid and pump.', normal: false },
  serpentine_belt: { situation: 'idling', name: 'Drive belt noise', advice: 'Check the serpentine (drive) belt for wear and tension.', normal: false },
  misfire: { situation: 'idling', name: 'Engine misfire', advice: 'Check spark plugs, ignition coils and injectors.', normal: false },
  tappet: { situation: 'idling', name: 'Tappet (valve) noise', advice: 'Check valve clearance and oil condition.', normal: false },
  normal_brakes: { situation: 'braking', name: 'Normal brakes', advice: 'No brake noise heard.', normal: true },
  worn_brakes: { situation: 'braking', name: 'Worn brakes', advice: 'Inspect brake pads and discs.', normal: false },
} as const satisfies Record<string, { situation: SoundSituation; name: string; advice: string; normal: boolean }>;

export type SoundLabel = keyof typeof SOUND_FAULTS;
export const SOUND_LABELS = Object.keys(SOUND_FAULTS) as SoundLabel[];

export const isSoundLabel = (s: string): s is SoundLabel => s in SOUND_FAULTS;

/** True when the label is a fault of that situation (a correction cannot move a braking sound to an engine fault). */
export const belongsTo = (label: string, situation: SoundSituation) => isSoundLabel(label) && SOUND_FAULTS[label].situation === situation;

/** Recordings the browser makes (WAV) and the other formats the service reads. */
const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/ogg': 'ogg',
};
export const AUDIO_TYPES = Object.keys(AUDIO_EXTENSIONS);
export const audioExtensionFor = (mimeType: string) => AUDIO_EXTENSIONS[mimeType] ?? 'bin';
