import type { ViewAngle } from './inspections.types';

/**
 * A simple line drawing of the side of a car to photograph, used in the empty photo slots. Drawn in currentColor, so
 * it takes the slot's text colour (and changes with hover and theme).
 */
export function VehicleSide({ angle }: { angle: ViewAngle }) {
  return (
    <svg className="as-dmg-side" viewBox="0 0 120 64" aria-hidden="true">
      {angle === 'left' || angle === 'right' ? (
        // Side profile; the right side is the left mirrored
        <g transform={angle === 'right' ? 'translate(120 0) scale(-1 1)' : undefined}>
          <path d="M6 44v-8c0-4 3-6 7-7l14-3 12-11c2-2 4-3 7-3h26c3 0 5 1 7 3l11 11 14 2c5 1 9 4 9 9v7" />
          <path d="M42 26l9-9h13v9z M70 17h12l8 9H70z" />
          <path d="M6 44h12 M42 44h36 M102 44h12" />
          <circle cx="30" cy="45" r="9" />
          <circle cx="90" cy="45" r="9" />
          <path d="M6 33h5" className="as-dmg-side-light" />
        </g>
      ) : angle === 'other' ? (
        // Close-up: a magnifier over a panel line
        <g>
          <path d="M10 46c20-6 40-6 60 0" />
          <circle cx="66" cy="28" r="15" />
          <path d="M77 39l13 13" />
          <path d="M60 24l5 7 4-6" className="as-dmg-side-light" />
        </g>
      ) : (
        // Front or rear: the same body, headlights in front, tail lights and a plate at the back
        <g>
          <path d="M18 44V30c0-3 2-5 4-6l8-12c2-2 4-3 7-3h46c3 0 5 1 7 3l8 12c2 1 4 3 4 6v14" />
          <path d="M32 22l6-9h44l6 9z" />
          <path d="M18 44h84 M24 44v8h12v-8 M84 44v8h12v-8" />
          {angle === 'front' ? (
            <>
              <path d="M24 31h14v6H24z M82 31h14v6H82z" className="as-dmg-side-light" />
              <path d="M44 34h32 M46 39h28" />
            </>
          ) : (
            <>
              <path d="M24 31h12v5H24z M84 31h12v5H84z" className="as-dmg-side-light" />
              <path d="M50 33h20v8H50z" />
            </>
          )}
        </g>
      )}
    </svg>
  );
}
