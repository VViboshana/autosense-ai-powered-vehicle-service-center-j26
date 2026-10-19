import type { ReactNode } from 'react';

/**
 * Drawings for the customer side: one icon per damage type (24-unit grid, drawn in currentColor) and a side view of
 * a car for a vehicle without a photo.
 */
const DAMAGE_PATHS: Record<string, ReactNode> = {
  dent: (
    <>
      <path d="M2 8h5c2.5 0 3 6 5 6s2.5-6 5-6h5" />
      <path d="M2 16h20" opacity=".35" />
      <path d="M12 3v2M7.5 4.5l1 1.5M16.5 4.5l-1 1.5" />
    </>
  ),
  scratch: <path d="M4 18L15 5M8 19l11-13M13 20l7-8" />,
  crack: (
    <>
      <path d="M12 2l-2 6 4 3-3 5 2 6" />
      <path d="M10 8l-5 2M14 11l5-1M11 16l-4 3" />
    </>
  ),
  glass_shatter: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M12 11l-4-7M12 11l7-3M12 11l5 9M12 11l-9 2M12 11l-3 9" />
    </>
  ),
  lamp_broken: (
    <>
      <path d="M4 9c0-2 1.5-3 4-3h7c3 0 6 2.5 6 6s-3 6-6 6H8c-2.5 0-4-1-4-3z" />
      <path d="M13 6l-2 4 3 2-2 3 1 3" />
    </>
  ),
  tire_flat: (
    <>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M3 18h18" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
};

export function DamageIcon({ label }: { label: string }) {
  return (
    <svg className="cp-dmg-svg" viewBox="0 0 24 24" aria-hidden="true">
      {DAMAGE_PATHS[label] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

/** A hatchback from the side, for a vehicle with no photo yet. */
export function CarArt() {
  return (
    <svg className="cp-car-art" viewBox="0 0 224 96" aria-hidden="true">
      <path className="body" d="M14 70V58c0-6 4-10 11-11l26-5 22-19c4-4 8-5 13-5h52c6 0 10 2 13 6l20 19 25 4c9 1 14 7 14 15v8c0 2-2 4-4 4H18c-2 0-4-2-4-4z" />
      <path className="glass" d="M80 42l16-17c2-2 4-3 7-3h17v20zM128 22h24c3 0 6 1 8 3l17 17h-49z" />
      <circle className="wheel" cx="56" cy="74" r="15" />
      <circle className="hub" cx="56" cy="74" r="6.5" />
      <circle className="wheel" cx="172" cy="74" r="15" />
      <circle className="hub" cx="172" cy="74" r="6.5" />
      <path className="lamp" d="M15 55h7v6h-7z" />
    </svg>
  );
}

/** "WP KP 0683" on a plate: the province letters small, as on Sri Lankan plates. */
export function PlateText({ plate }: { plate: string }) {
  const m = /^([A-Z]{2})\s+(.+)$/.exec(plate);
  return m ? <><small>{m[1]}</small>{m[2]}</> : <>{plate}</>;
}
