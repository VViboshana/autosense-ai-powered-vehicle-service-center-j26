import { useState, type CSSProperties } from 'react';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { useApi } from '@/lib/useApi';
import type { ReportSummary, SummaryLanguage } from './customer.types';

const LANGUAGES: { key: SummaryLanguage; name: string; lang: string }[] = [
  { key: 'en', name: 'English', lang: 'en' },
  { key: 'si', name: 'සිංහල', lang: 'si' },
  { key: 'ta', name: 'தமிழ்', lang: 'ta' },
];
const STORE_KEY = 'as.report.lang';

/** The language this viewer picked last time (a convenience only: storage may be blocked). */
function rememberedLanguage(): SummaryLanguage {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return LANGUAGES.some((l) => l.key === v) ? (v as SummaryLanguage) : 'en';
  } catch {
    return 'en';
  }
}

/**
 * "In plain words": a few sentences retelling the confirmed report, in English, Sinhala or Tamil. Written by an AI
 * from the technician-checked facts, or by a simple template when the AI writer is not available (always said).
 */
export function PlainWords({ vehicleId, inspectionId }: { vehicleId: number; inspectionId: number }) {
  const [language, setLanguage] = useState(rememberedLanguage);
  const { data, error, loading, busy, reload } = useApi<ReportSummary>(
    `/my/vehicles/${vehicleId}/inspections/${inspectionId}/summary`,
    { lang: language },
  );

  function pick(next: SummaryLanguage) {
    setLanguage(next);
    try { window.localStorage.setItem(STORE_KEY, next); } catch { /* not remembered; still switches */ }
  }

  const shown = data && data.requested === language ? data : undefined;
  return (
    <div className="cp-plain cp-rise" style={{ '--i': 5 } as CSSProperties}>
      <div className="cp-plain-head">
        <span className="cp-eyebrow"><i className="bi bi-chat-square-text me-1" aria-hidden="true" />In plain words</span>
        <div className="cp-langs as-no-print" role="group" aria-label="Language">
          {LANGUAGES.map((l) => (
            <button key={l.key} type="button" lang={l.lang} aria-pressed={language === l.key} onClick={() => pick(l.key)}>{l.name}</button>
          ))}
        </div>
      </div>
      {error && !shown ? (
        <ErrorState inline error={error} onRetry={reload} />
      ) : loading || !shown ? (
        <div className="d-grid gap-2" aria-busy={busy}><Skeleton /><Skeleton /><Skeleton width="60%" /></div>
      ) : (
        <>
          <p className="cp-plain-text" lang={shown.language} aria-busy={busy}>{shown.text}</p>
          <p className="cp-plain-foot">
            {shown.source === 'ai' ? (
              <><i className="bi bi-stars me-1" aria-hidden="true" />Written by AI from the technician-checked report below. If anything differs, the report below is correct.</>
            ) : (
              <>
                <i className="bi bi-info-circle me-1" aria-hidden="true" />A short summary of the report below.
                {shown.requested !== 'en' && ' The translation is not available right now, so it is shown in English.'}
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
