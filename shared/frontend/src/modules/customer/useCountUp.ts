import { useEffect, useState } from 'react';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A number that counts up from 0 to `end` (easing out over about a second), or shows `end` at once for reduced motion. */
export function useCountUp(end: number, delayMs = 300, durationMs = 900) {
  const [value, setValue] = useState(() => (reducedMotion() ? end : 0));
  useEffect(() => {
    if (reducedMotion() || end === 0) {
      setValue(end);
      return;
    }
    let frame = 0;
    const start = performance.now() + delayMs;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / durationMs));
      setValue(Math.round(end * (1 - Math.pow(1 - k, 3))));
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [end, delayMs, durationMs]);
  return value;
}
