import type { Toast } from './useToasts';

/** The confirmations from useToasts, bottom right. Announced to screen readers without moving focus. */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="as-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`as-toast as-toast-${t.tone}`}>
          <i className={`bi ${t.tone === 'success' ? 'bi-check-circle-fill' : 'bi-info-circle-fill'}`} aria-hidden="true" />
          {t.text}
        </div>
      ))}
    </div>
  );
}
