import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A menu that opens under a button and closes on outside click or Escape. Uses Bootstrap's dropdown styles without
 * Bootstrap's script, so React stays in control of the page.
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
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
      <div
        id={id}
        className={`dropdown-menu ${align === 'end' ? 'dropdown-menu-end' : ''} ${open ? 'show' : ''} ${menuClassName}`}
        style={align === 'end' ? { right: 0, left: 'auto' } : undefined}
      >
        {typeof children === 'function' ? children(close) : children}
      </div>
    </div>
  );
}
