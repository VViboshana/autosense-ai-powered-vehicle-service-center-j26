import { Link } from 'react-router-dom';

/** The AutoSense mark: an orange square with a bay outline and a sensor dot. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#F26A1B" />
      <path d="M9 24V10h14v14" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="17" r="3.2" fill="#fff" />
    </svg>
  );
}

/** Mark + "AutoSense" wordmark, linking home. For dark backgrounds. */
export function Brand({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="as-brand" aria-label="AutoSense home">
      <BrandMark />
      <span className="as-brand-text">
        Auto<b>Sense</b>
      </span>
    </Link>
  );
}
