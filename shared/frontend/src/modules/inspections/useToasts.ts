import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'success' | 'info';
export type Toast = { id: number; text: string; tone: ToastTone };

const SHOW_MS = 3200;

/** Short confirmations after an action ("Region confirmed"); each disappears by itself after about 3 seconds. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const show = useCallback((text: string, tone: ToastTone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { id, text, tone }]); // at most three on screen
    timers.current.push(window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), SHOW_MS));
  }, []);

  return { toasts, show };
}
