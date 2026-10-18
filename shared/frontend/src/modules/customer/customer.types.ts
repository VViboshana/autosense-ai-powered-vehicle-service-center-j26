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

/** One region a technician confirmed, numbered across the report (the same number on the photo and in the list). */
export type ReportFinding = {
  no: number;
  label: string;
  severity: string | null;
  location: string | null;
  bbox: number[];
  polygon: number[][] | null;
};

/** A confirmed inspection, as the customer sees it: checked regions only, no model confidence. */
export type InspectionReport = {
  inspectionId: number;
  inspectionNo: string;
  confirmedAt: string;
  overallSeverity: string | null;
  notes: string | null;
  photos: { imageId: number; viewAngle: string; width: number | null; height: number | null; url: string; findings: ReportFinding[] }[];
  findings: (ReportFinding & { viewAngle: string })[];
};

type Section<T> ={ available: false } | { available: true; connected?: boolean; data: T };

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
    inspections: Section<InspectionReport[]>;
    maintenance: Section<null>;
    safety: Section<null>;
  };
};
