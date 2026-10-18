import type { ForecastStatus } from './maintenance.types';
import type { Tone } from '@/components/ui/StatusPill';

export const statusTone: Record<ForecastStatus, Tone> = { Preliminary: 'muted', 'Awaiting review': 'info', Confirmed: 'success', 'Needs inspection': 'warning' };
