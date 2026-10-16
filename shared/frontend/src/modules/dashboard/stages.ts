import type { Tone } from '@/components/ui/StatusPill';
import type { JobStage } from './dashboard.types';

/** How each job stage is shown: label, pill colour and position on the 5-step progress strip. */
export const STAGES: Record<JobStage, { label: string; tone: Tone; step: number }> = {
  checked_in: { label: 'Checked in', tone: 'muted', step: 1 },
  inspected: { label: 'Inspected', tone: 'info', step: 2 },
  waiting_for_bay: { label: 'Waiting for bay', tone: 'warning', step: 3 },
  in_bay: { label: 'In bay', tone: 'brand', step: 4 },
  ready: { label: 'Ready for pickup', tone: 'success', step: 5 },
  completed: { label: 'Collected', tone: 'muted', step: 5 },
  cancelled: { label: 'Cancelled', tone: 'muted', step: 0 },
};
