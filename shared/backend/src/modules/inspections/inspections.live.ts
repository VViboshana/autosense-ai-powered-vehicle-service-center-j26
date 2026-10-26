import { analysePhoto, type DamagePrediction, type PhotoUpload } from '../../integrations/ml/damageService.js';

/**
 * Live walk-around: one camera frame at a time, while the technician walks round the vehicle. The damage service
 * answers where the vehicle is and what damage it sees; the phone draws it over the camera view and decides when a
 * side is captured. Nothing is stored: the photos chosen are sent later as a normal new inspection.
 * One frame per user at a time (the phone sends the next one when this one is answered), so a slow laptop is never
 * flooded; a frame arriving while the previous one is still being analysed is answered "busy" at once.
 * Damage is sent even when no vehicle is found: the phone keeps showing it for a few seconds after it last saw a vehicle
 * (walking up for a close-up, only part of the car is in view), and hides it otherwise.
 */
export type LiveFrame = {
  busy: boolean;
  width: number;
  height: number;
  /** The main vehicle: box in the frame's pixels, its share of the frame, and whether it runs off the edges */
  vehicle: { bbox: number[]; share: number; cropped: boolean } | null;
  /** A person clearly in view: shown as "that's a person, not a vehicle" when there is no vehicle */
  person: boolean;
  quality: { blurVar: number; brightness: number; warnings: string[] } | null;
  /** Damage on the vehicle, strongest first; possible = below the finding threshold */
  detections: { label: string; confidence: number; bbox: number[]; polygon: number[][]; possible: boolean }[];
  ms: number;
};

const inFlight = new Set<number>();
const BUSY: LiveFrame = { busy: true, width: 0, height: 0, vehicle: null, person: false, quality: null, detections: [], ms: 0 };

export async function liveFrame(baseUrl: string | undefined, userId: number, frame: PhotoUpload): Promise<LiveFrame> {
  if (inFlight.has(userId)) return BUSY;
  inFlight.add(userId);
  try {
    // A live frame that takes longer than this is no longer live: the phone simply sends the next one
    return summarise(await analysePhoto(baseUrl, frame, 10_000));
  } finally {
    inFlight.delete(userId);
  }
}

export function summarise(p: DamagePrediction): LiveFrame {
  const { width, height } = p.image;
  return {
    busy: false,
    width,
    height,
    vehicle: p.vehicle ? { bbox: p.vehicle.bbox, share: Math.round((p.vehicle.areaPx / (width * height)) * 1000) / 1000, cropped: p.vehicle.cropped } : null,
    person: p.person,
    quality: { blurVar: p.quality.blurVar, brightness: p.quality.brightness, warnings: p.quality.warnings },
    detections: p.detections
      .filter((d) => d.onVehicle)
      .sort((a, b) => b.confidence - a.confidence)
      .map((d) => ({ label: d.label, confidence: d.confidence, bbox: d.bbox, polygon: d.polygon, possible: d.possible })),
    ms: Math.round(p.processingMs),
  };
}
