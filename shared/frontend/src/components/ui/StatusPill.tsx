import type { ReactNode } from 'react';

/** brand = active/in progress · success = free/done · warning = needs attention · danger = alert · info = in review */
export type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`as-pill as-pill-${tone}`}>{children}</span>;
}
