import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

const BITS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2;
  const reach = 90 + (i % 3) * 30;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, turn: i * 40, tone: ['brand', 'success', 'info', 'warning'][i % 4] };
});

/**
 * The moment an inspection is confirmed: a check mark draws itself with a small burst, and says what happens next
 * (the customer can see the report). Closes on either button, Escape or the backdrop.
 */
export function Celebration({ title, children, primary, onPrimary, onClose }: {
  title: string;
  children: ReactNode;
  primary: string;
  onPrimary: () => void;
  onClose: () => void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    button.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="as-celebrate" role="dialog" aria-modal="true" aria-labelledby="celebrate-title" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="as-celebrate-card">
        {BITS.map((b, i) => (
          <i key={i} className={`as-burst as-burst-${b.tone}`} style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.turn}deg` } as CSSProperties} aria-hidden="true" />
        ))}
        <svg viewBox="0 0 76 76" aria-hidden="true">
          <circle className="c1" cx="38" cy="38" r="34" />
          <circle className="c2" cx="38" cy="38" r="25" transform="rotate(-90 38 38)" />
          <path className="ck" d="M27 39l8 8 15-17" />
        </svg>
        <h2 id="celebrate-title">{title}</h2>
        <p className="text-body-secondary mb-0">{children}</p>
        <div className="d-flex gap-2 justify-content-center flex-wrap mt-2">
          <button type="button" className="btn btn-light" onClick={onClose}>Stay here</button>
          <button ref={button} type="button" className="btn btn-primary" onClick={onPrimary}>{primary}</button>
        </div>
      </div>
    </div>
  );
}
