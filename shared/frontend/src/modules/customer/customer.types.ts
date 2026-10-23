import type { JobStage } from '@/modules/dashboard/dashboard.types';
import type { AreaRepair, Priority, RepairPlan } from '@/modules/inspections/inspections.types';

export type ViewAngle = 'front' | 'rear' | 'left' | 'right' | 'other';

/** Shapes returned by /api/my/* (see backend/src/modules/my). */
export type MyVehicles = {
  vehicles: {
    vehicleId: number;
    registrationNo: string;
    description: string;
    photoUrl: string | null;
    visit: { stage: JobStage; checkedInAt: string; bay: string | null; queuePosition: number | null; planReady: boolean } | null;
    latestInspection: { inspectionNo: string; confirmedAt: string; overallSeverity: string | null; areas: number; priority: Priority | null } | null;
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
 * (backend inspections.areas.ts). Numbered across the report: the same number on the photo, the map and the list.
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
  /** How urgent, which service fixes it, and its estimated effort (repair-v0) */
  repair: AreaRepair;
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
  /** What needs doing: most urgent priority, the services with their areas, the total estimated effort */
  repair: RepairPlan;
  /** What the technician confirmed from the sound recordings (none when the vehicle was not recorded) */
  sounds: { situation: 'starting' | 'idling' | 'braking'; label: string; name: string; advice: string; normal: boolean }[];
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
      planReady: boolean;
    } | null>;
    inspections: Section<InspectionReport[]>;
    maintenance: Section<{ category: string; selectedTask: string | null; estimatedHours: number | null; estimatedMinutes: number | null; status: string; confirmedAt: string; thisVisit: boolean; jobNo: string | null; inspectionNo: string | null } | null>;
    safety: Section<null>;
  };
};

export type BookingStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'checked_in';

/** A service booking (/api/my/bookings). date is 'YYYY-MM-DD' and time 'HH:MM', in the service centre's time. */
export type Booking = {
  bookingId: number;
  bookingNo: string;
  status: BookingStatus;
  date: string;
  time: string;
  service: string;
  minutes: number;
  notes: string | null;
  staffNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  vehicle: { vehicleId: number; registrationNo: string; description: string; photoUrl: string | null };
};

export type MyBookings = { upcoming: Booking[]; past: Booking[] };

export type BookingOptions = {
  vehicles: { vehicleId: number; registrationNo: string; description: string; photoUrl: string | null }[];
  services: { serviceTypeId: number; code: string; name: string; minutes: number }[];
  days: { date: string; closed: boolean; slots: { time: string; left: number }[] }[];
  minHoursAhead: number;
};

/** One visit in the service history (/api/my/history). */
export type Visit = {
  jobId: number;
  jobNo: string;
  stage: JobStage;
  service: string;
  bay: string | null;
  checkedInAt: string;
  readyAt: string | null;
  completedAt: string | null;
  estimateLkr: number | null;
  estimatedMinutes: number | null;
  vehicle: { vehicleId: number; registrationNo: string; description: string; photoUrl: string | null };
  inspection: { inspectionId: number; inspectionNo: string; overallSeverity: string | null } | null;
};

export type MyHistory = { visits: Visit[]; totals: { visits: number; completed: number; vehicles: number; reports: number } };

export type Notice = {
  id: string;
  title: string;
  body: string | null;
  at: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'brand' | 'muted';
  icon: string;
  link: string | null;
  unread: boolean;
};

export type MyNotifications = { unread: number; items: Notice[] };
