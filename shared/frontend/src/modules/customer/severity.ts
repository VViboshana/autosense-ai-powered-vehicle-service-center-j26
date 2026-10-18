/** Severity is a state, so it uses the state colours (the same as the staff inspection screens). */
export const SEVERITY_TONE: Record<string, 'info' | 'warning' | 'danger' | 'muted'> = {
  minor: 'info',
  moderate: 'warning',
  severe: 'danger',
  unavailable: 'muted',
};
