/**
 * Quick photo check in the browser, before uploading: the same three checks as the damage service's quality.py,
 * with the same limits, done on the photo scaled to 640 px (the size the model looks at). It is advice for the person
 * taking the photo; the service checks again on the full photo.
 */
export type PhotoCheck = { width: number; height: number; brightness: number; blurVar: number; warnings: string[] };

const MIN_SIDE_PX = 480;
const BLUR_MIN = 100; // variance of the Laplacian; lower = blurrier
const BRIGHTNESS: [number, number] = [40, 220]; // mean grey level 0-255
const CHECK_SIZE = 640;

export async function checkPhoto(file: File): Promise<PhotoCheck> {
  const bitmap = await createImageBitmap(file); // applies the phone's rotation tag, like the service does
  const { width, height } = bitmap;
  const scale = Math.min(1, CHECK_SIZE / Math.max(width, height));
  const w = Math.max(3, Math.round(width * scale));
  const h = Math.max(3, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, w, h).data;

  // Grey level of each pixel (the usual luminance weights)
  const grey = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < grey.length; i++) {
    const g = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    grey[i] = g;
    sum += g;
  }
  const brightness = sum / grey.length;

  // Sharpness: variance of the Laplacian (edge strength). A blurred photo has weak edges, so little variance.
  let n = 0;
  let mean = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * grey[i]! - grey[i - 1]! - grey[i + 1]! - grey[i - w]! - grey[i + w]!;
      n += 1;
      const d = lap - mean; // Welford's running variance: one pass, no second array
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  const blurVar = n > 1 ? m2 / (n - 1) : 0;

  const warnings: string[] = [];
  if (Math.min(width, height) < MIN_SIDE_PX) warnings.push('Low resolution');
  if (blurVar < BLUR_MIN) warnings.push('Looks blurry');
  if (brightness < BRIGHTNESS[0]) warnings.push('Too dark');
  else if (brightness > BRIGHTNESS[1]) warnings.push('Too bright');
  return { width, height, brightness: Math.round(brightness), blurVar: Math.round(blurVar), warnings };
}
