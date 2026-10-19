import { useCountUp } from '@/lib/useCountUp';

/** A whole number that counts up from 0 when it first appears (at once for reduced motion), then shows the value. */
export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
}
