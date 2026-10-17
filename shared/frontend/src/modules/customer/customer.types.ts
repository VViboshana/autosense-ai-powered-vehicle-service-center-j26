import type { JobStage } from '@/modules/dashboard/dashboard.types';

/** Shapes returned by /api/my/* (see backend/src/modules/my). */
export type MyVehicles = {
  vehicles: {
    vehicleId: number;
    registrationNo: string;
    description: string;
    visit: { stage: JobStage; checkedInAt: string; bay: string | null } | null;
  }[];
  requests: {
    claimId: number;
    registrationNo: string;
    status: 'pending' | 'rejected';
    note: string | null;
    reviewNote: string | null;
    requestedAt: string;
    reviewedAt: string | null;
  }[];
};

type Section<T> = { available: false } | { available: true; connected?: boolean; data: T };

export type MyVehicle = {
  vehicle: { vehicleId: number; registrationNo: string; description: string; colour: string | null; fuelType: string | null };
  sections: {
    status: Section<{
      jobNo: string;
      stage: JobStage;
      service: string;
      bay: string | null;
      checkedInAt: string;
      bayEnteredAt: string | null;
      readyAt: string | null;
      queuePosition: number | null;
      estimatedReadyAt: string | null;
    } | null>;
    inspections: Section<
      { inspectionNo: string; confirmedAt: string; overallSeverity: string | null; findings: { label: string; location: string | null; severity: string | null }[] }[]
    >;
    maintenance: Section<null>;
    safety: Section<null>;
  };
};
