import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A dialog over the page (Bootstrap modal styles, controlled by React). Closes on Escape and on the backdrop.
 * Put the form's buttons in `footer`. Focus moves into the dialog when it opens.
 */
export function Modal({ title, onClose, children, footer, size }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'lg';
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    dialog.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.btn-close)')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal fade show d-block" role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable${size ? ` modal-${size}` : ''}`} ref={dialog}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title h6 fw-semibold" id={id}>
                {title}
              </h2>
              <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
    </>
  );
}
