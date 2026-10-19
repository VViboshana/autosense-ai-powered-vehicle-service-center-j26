/**
 * The service centre's public details, shown on the public website, the customer portal footer and printouts.
 * Change them here only: every page reads this file.
 *
 * TODO: replace the placeholder values below with the centre's real details.
 */
export const BUSINESS = {
  name: 'AutoSense Service Centre',
  tagline: 'AI-assisted vehicle service',
  address: { line1: '123 Galle Road', line2: 'Colombo 03', country: 'Sri Lanka' },
  phone: '+94 11 234 5678',
  /** Digits only, with the country code: used for tel: and WhatsApp links. */
  phoneDigits: '94112345678',
  whatsappDigits: '94771234567',
  email: 'hello@autosense.lk',
  hours: [
    { days: 'Monday – Friday', time: '8:00 – 17:30' },
    { days: 'Saturday', time: '8:00 – 14:00' },
    { days: 'Sunday & Poya days', time: 'Closed' },
  ],
  /** Google Maps search for the address; opened from "Get directions". */
  mapsQuery: '123 Galle Road, Colombo 03, Sri Lanka',
  founded: 2026,
} as const;

export const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(BUSINESS.mapsQuery)}`;
export const telUrl = `tel:+${BUSINESS.phoneDigits}`;
export const whatsappUrl = `https://wa.me/${BUSINESS.whatsappDigits}`;
export const mailUrl = (subject?: string) => `mailto:${BUSINESS.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;

/**
 * Services described for customers. `code` matches workshop.service_types (database/reference/040_service_types.sql),
 * so "Book this" can pick the same service in the booking form.
 */
export const SERVICES = [
  {
    code: 'FULL_SERVICE',
    name: 'Full service',
    icon: 'bi-gear-wide-connected',
    time: 'About 3 hours',
    summary: 'Oil and filters, brakes, fluids, belts, tyres, lights and a road test, to the maker\'s schedule.',
    points: ['Engine oil & oil filter', 'Air & cabin filters', 'Brake and suspension check', 'Fluids topped up', 'Road test'],
  },
  {
    code: 'OIL_CHANGE',
    name: 'Oil & filter change',
    icon: 'bi-droplet-half',
    time: 'About 45 minutes',
    summary: 'The right grade of oil for your engine and a new filter, with a quick safety check while you wait.',
    points: ['Grade matched to your engine', 'New oil filter', 'Level and leak check', 'Next service reminder'],
  },
  {
    code: 'BRAKE_SERVICE',
    name: 'Brake service',
    icon: 'bi-disc',
    time: 'About 2½ hours',
    summary: 'Pads, discs, drums and brake fluid checked and replaced where needed, so you stop straight and short.',
    points: ['Pads and shoes measured', 'Discs and drums checked', 'Brake fluid test', 'Handbrake adjusted'],
  },
  {
    code: 'BODY_REPAIR',
    name: 'Body repair',
    icon: 'bi-car-front',
    time: 'From 6 hours',
    summary: 'Dents, scratches and cracks found by our AI inspection, repaired and colour-matched by technicians.',
    points: ['AI damage inspection', 'Dent and scratch repair', 'Paint colour matching', 'Before & after photos'],
  },
  {
    code: 'AC_REPAIR',
    name: 'AC repair',
    icon: 'bi-snow',
    time: 'About 75 minutes',
    summary: 'Cold air again: gas, leaks, the compressor and cabin filter checked for the Sri Lankan heat.',
    points: ['Cooling performance test', 'Leak check', 'Gas recharge', 'Cabin filter'],
  },
  {
    code: 'HYBRID_CHECK',
    name: 'Hybrid battery check',
    icon: 'bi-battery-charging',
    time: 'About 90 minutes',
    summary: 'A health check of the hybrid battery and its cooling, with a clear report on what it needs.',
    points: ['Cell balance test', 'Cooling fan & filter', 'Inverter check', 'Written report'],
  },
  {
    code: 'EV_BATTERY',
    name: 'Battery health check',
    icon: 'bi-lightning-charge',
    time: 'About 1 hour',
    summary: 'For electric vehicles: battery health, charging and the high-voltage system, tested safely.',
    points: ['State of health', 'Charging port test', 'High-voltage safety check', 'Written report'],
  },
  {
    code: 'ENGINE_REPAIR',
    name: 'Engine repair',
    icon: 'bi-wrench-adjustable',
    time: 'From 4 hours',
    summary: 'Warning lights, rough running or noise: diagnosed with a scan tool, then repaired with your approval.',
    points: ['Scan-tool diagnosis', 'Estimate before work', 'Nothing done without your go-ahead', 'Progress in your portal'],
  },
] as const;

/** Where "Book this service" goes: the booking form for customers, otherwise sign-up first (then the form). */
export function bookingLink(signedIn: boolean, code?: string) {
  const form = `/my/bookings/new${code ? `?service=${code}` : ''}`;
  return signedIn ? form : `/register?next=${encodeURIComponent(form)}`;
}
