import type { JobStage } from '@/modules/dashboard/dashboard.types';

export type ViewAngle = 'front' | 'rear' | 'left' | 'right' | 'other';

/** Shapes returned by /api/my/* (see backend/src/modules/my). */
export type MyVehicles = {
  vehicles: {
    vehicleId: number;
    registrationNo: string;
    description: string;
    photoUrl: string | null;
    visit: { stage: JobStage; checkedInAt: string; bay: string | null; queuePosition: number | null } | null;
    latestInspection: { inspectionNo: string; confirmedAt: string; overallSeverity: string | null; areas: number } | null;
  }[];
  requests: {
    claimId: number;
    registrationNo: string;
    status: 'pending' | 'rejected';
    note: string | null;
    reviewNote: string | null;
    requestedAt: string;
    reviewedAt: string | null;
    photoUrl: string | null;
  }[];
};

/**
 * One damaged area a technician checked: overlapping regions of the same damage on a photo are joined into one
 * (backend reportAreas.ts). Numbered across the report: the same number on the photo, the map and the list.
 */
export type ReportArea = {
  no: number;
  label: string;
  severity: string | null;
  /** Where on the car, e.g. "Left headlight", "Rear bumper, right side" */
  where: string;
  /** The area's centre across and down its photo, 0 to 1 */
  x: number;
  y: number;
  bbox: [number, number, number, number];
  outlines: number[][][];
  marks: number;
  addedByTechnician: boolean;
};

/** A confirmed inspection, as the customer sees it: checked areas only, no model confidence. */
export type InspectionReport = {
  inspectionId: number;
  inspectionNo: string;
  confirmedAt: string;
  overallSeverity: string | null;
  notes: string | null;
  photos: { imageId: number; viewAngle: ViewAngle; width: number; height: number; url: string; areas: ReportArea[] }[];
  areas: (ReportArea & { viewAngle: ViewAngle; imageId: number })[];
};

type Section<T> = { available: false } | { available: true; connected?: boolean; data: T };

export type MyVehicle = {
  vehicle: {
    vehicleId: number;
    registrationNo: string;
    description: string;
    colour: string | null;
    fuelType: string | null;
    photoUrl: string | null;
  };
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
