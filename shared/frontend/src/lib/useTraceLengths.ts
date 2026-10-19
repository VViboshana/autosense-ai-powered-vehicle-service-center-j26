import { useLayoutEffect, useRef } from 'react';

/**
 * For lines that draw themselves: sets --len (the shape's length) on each SVG shape matching `selector`, so CSS can
 * animate stroke-dashoffset from --len to 0, and --dl, a delay that grows along the shapes (delayMs + i * stepMs).
 * Runs before the browser paints, so a shape never shows half-styled. Measures again when `redo` changes.
 */
export function useTraceLengths<T extends Element>(selector: string, delayMs = 0, stepMs = 0, redo: unknown = null) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<SVGGeometryElement>(selector).forEach((el, i) => {
      el.style.setProperty('--len', el.getTotalLength().toFixed(1));
      el.style.setProperty('--dl', `${delayMs + i * stepMs}ms`);
    });
  }, [selector, delayMs, stepMs, redo]);
  return ref;
}
