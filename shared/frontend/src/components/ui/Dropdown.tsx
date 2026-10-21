import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * A menu that opens under a button and closes on outside click or Escape. Uses Bootstrap's dropdown styles without
 * Bootstrap's script, so React stays in control of the page. The open menu is rendered on <body> with fixed
 * positioning, so a table that scrolls sideways (or rows that animate in) can't clip it or paint over it.
 */
export function Dropdown({ trigger, label, buttonClassName = '', align = 'end', menuClassName = '', children }: {
  trigger: ReactNode;
  label: string;
  buttonClassName?: string;
  align?: 'start' | 'end';
  menuClassName?: string;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Place the menu under the button (or above it when there is no room below) and follow it on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const btn = ref.current?.getBoundingClientRect();
      if (!btn) return;
      const height = menuRef.current?.offsetHeight ?? 0;
      const gap = 4;
      const below = window.innerHeight - btn.bottom - gap;
      const top = height && below < height && btn.top - gap > below ? btn.top - gap - height : btn.bottom + gap;
      setPos(
        align === 'end'
          ? { position: 'fixed', top, right: Math.max(8, window.innerWidth - btn.right), left: 'auto', zIndex: 1070 }
          : { position: 'fixed', top, left: Math.max(8, btn.left), right: 'auto', zIndex: 1070 },
      );
    };
    place();
    // Measure again once the menu is in the page, so the flip upwards uses its real height.
    const frame = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  const close = () => setOpen(false);
  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={menuRef}
            className={`dropdown-menu show ${menuClassName}`}
            style={pos ?? { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>,
          document.body,
        )}
    </div>
  );
}
