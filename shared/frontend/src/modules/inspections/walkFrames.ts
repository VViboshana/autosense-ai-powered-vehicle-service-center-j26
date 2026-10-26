import { ApiError, apiUpload } from '@/lib/api';
import type { ViewAngle } from './inspections.types';

/**
 * Walk-around inspection: the technician walks round the vehicle with the phone camera (live) or uploads a video of
 * the walk. Frames go to POST /api/inspections/live-frame one at a time; the answers decide which frame becomes each
 * side's photo. The sides are known from the ORDER of the walk (front, left, rear, right), because a single photo cannot
 * reliably tell the left side from the right (a mirrored car looks the same).
 */
export type LiveFrame = {
  busy: boolean;
  width: number;
  height: number;
  vehicle: { bbox: number[]; share: number; cropped: boolean } | null;
  person: boolean;
  quality: { blurVar: number; brightness: number; warnings: string[] } | null;
  detections: { label: string; confidence: number; bbox: number[]; polygon: number[][]; possible: boolean }[];
  ms: number;
};

export type WalkResult = { sides: Partial<Record<ViewAngle, File>>; closeups: File[] };

/** The order of the walk: start at the front, then the vehicle's left side (the passenger side in a right-hand-drive car), the rear, the right side. */
export const SIDES: ViewAngle[] = ['front', 'left', 'rear', 'right'];
export const SEND_SIZE = 640; // the size the damage model looks at
export const MIN_SHARE = 0.2; // the vehicle must cover at least this share of the frame to be a side photo
const BLUR_MIN = 100; // same as the damage service's quality check
const DARK = 40;
export const HOLD_MS = 900; // a side is captured after it has been good for this long
export const CLOSEUP_CONFIDENCE = 0.5;
export const MAX_CLOSEUPS = 3;
export const CLOSEUP_GAP_MS = 2500;
// Damage is shown only while a vehicle is in view, or was in the last few seconds: walking up to a dent for a close-up,
// only part of the car fills the frame and the vehicle finder may not recognise it.
export const VEHICLE_LOCK_MS = 3000;

/** The frame as it should be shown: without damage when no vehicle is (or just was) in view. */
export function gate(f: LiveFrame, vehicleSeenAt: number | null, now: number): { frame: LiveFrame; paused: 'person' | 'none' | null } {
  if (f.vehicle || (vehicleSeenAt !== null && now - vehicleSeenAt < VEHICLE_LOCK_MS)) return { frame: f, paused: null };
  return { frame: { ...f, detections: [] }, paused: f.person ? 'person' : 'none' };
}

/**
 * Which way the vehicle is seen, from its box's width : height. From the front or the rear a car is narrow, from the
 * side long. Measured on CarDD photos of whole cars (box width / height): front median 1.22 (10-90%: 0.81-1.58), rear
 * 1.09 (0.74-1.55), side 2.12 (1.45-2.79). In between is a corner. Used so a side is only captured from that side: the
 * front cannot be captured again as "left side" while the technician is still standing in front of the car.
 */
export const END_MAX = 1.6;
export const SIDE_MIN = 1.9;
export const CAPTURE_GAP_MS = 1500; // after a capture, the next one waits at least this long
export type View = 'end' | 'side' | 'corner';
export const EXPECTED: Partial<Record<ViewAngle, 'end' | 'side'>> = { front: 'end', rear: 'end', left: 'side', right: 'side' };

export function viewOf(f: LiveFrame): View | null {
  const b = f.vehicle?.bbox;
  if (!b) return null;
  const ratio = (b[2]! - b[0]!) / Math.max(1, b[3]! - b[1]!);
  return ratio <= END_MAX ? 'end' : ratio >= SIDE_MIN ? 'side' : 'corner';
}

/**
 * Is this frame good enough to be the photo of `side`? If not, what should the person do. Without a side, only the
 * photo itself is judged (size, sharpness, light).
 */
export function judge(f: LiveFrame | null, side?: ViewAngle): { ready: boolean; hint: string } {
  if (!f) return { ready: false, hint: 'Starting the AI…' };
  if (!f.vehicle) return { ready: false, hint: f.person ? "That's a person, not a vehicle" : 'Point the camera at the vehicle' };
  if (f.vehicle.cropped && f.vehicle.share > 0.5) return { ready: false, hint: 'Step back so the whole side fits' };
  if (f.vehicle.share < MIN_SHARE) return { ready: false, hint: 'Move closer to the vehicle' };
  if (f.quality && f.quality.brightness < DARK) return { ready: false, hint: 'Too dark: find more light' };
  if (f.quality && f.quality.blurVar < BLUR_MIN) return { ready: false, hint: 'Hold the phone steady' };
  const expected = side && EXPECTED[side];
  const view = viewOf(f);
  if (expected && view !== expected) {
    const where = side === 'front' ? 'the front' : side === 'rear' ? 'the rear' : `the ${side} side`;
    return { ready: false, hint: view === 'corner' ? `Keep walking to ${where}` : `Walk round to ${where}` };
  }
  return { ready: true, hint: 'Hold still…' };
}

/** How good a frame is as the photo of `side` (0 = unusable): a large, sharp, whole vehicle, seen from that side. */
export function score(f: LiveFrame, side?: ViewAngle) {
  if (!judge(f, side).ready || !f.vehicle) return 0;
  return f.vehicle.share * Math.min(1, (f.quality?.blurVar ?? BLUR_MIN) / 300);
}

/** The strongest damage finding in a frame (not possible damage), for close-ups. */
export function strongest(f: LiveFrame) {
  return f.detections.find((d) => !d.possible) ?? null;
}

/** Draws the video's current frame (or another canvas) on a new canvas, at most maxSide pixels on the long side. */
export function drawFrame(source: HTMLVideoElement | HTMLCanvasElement, maxSide: number) {
  const w = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const h = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function toJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No frame'))), 'image/jpeg', quality));
}

export function toFile(blob: Blob, name: string) {
  return new File([blob], name, { type: 'image/jpeg' });
}

/** Sends one frame; waits and retries while the server is still on the previous one. */
export async function sendFrame(blob: Blob, signal?: AbortSignal): Promise<LiveFrame> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const form = new FormData();
    form.append('frame', blob, 'frame.jpg');
    const answer = await apiUpload<LiveFrame>('/inspections/live-frame', form);
    if (!answer.busy) return answer;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new ApiError(503, 'BUSY', 'The AI is busy. Try again in a moment.');
}

/** Why the camera could not start, in words for the person holding the phone. */
export function cameraProblem(err: unknown) {
  if (!window.isSecureContext) {
    return 'The camera needs a secure (https) connection. On the laptop start AutoSense with "npm run dev:phone" and open the https:// address on the phone.';
  }
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site in the browser settings, then try again.';
  if (err instanceof DOMException && err.name === 'NotFoundError') return 'No camera was found on this device.';
  return 'The camera could not be started. Close other apps using the camera and try again.';
}
