// The car on the damage map, seen from above, front at the top: body from x 40 to 160, y 20 to 340
const SIDE_X = { left: 24, right: 176 };
const END_Y = { front: 12, rear: 348 };
const POS: Record<string, number> = { left: 0.2, centre: 0.5, right: 0.8 };

/**
 * Where on the car a finding is, approximately. The photo gives the side; the finding's place in the photo ("lower
 * left") gives the position along that side, once turned to the car: standing at the car's left side, the left of the
 * photo is the car's front; facing its front, the left of the photo is the car's right side; and so on.
 */
export function mapPosition(view: string, location: string | null): { x: number; y: number } | null {
  const t = POS[location?.split(' ')[1] ?? ''] ?? 0.5;
  switch (view) {
    case 'front': return { x: 160 - t * 120, y: END_Y.front };
    case 'rear': return { x: 40 + t * 120, y: END_Y.rear };
    case 'left': return { x: SIDE_X.left, y: 70 + t * 220 };
    case 'right': return { x: SIDE_X.right, y: 290 - t * 220 };
    default: return null; // a close-up has no side
  }
}
