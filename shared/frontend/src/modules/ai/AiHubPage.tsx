import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/layout/PageHeader';
import { useApi } from '@/lib/useApi';
import { AiDamageTab } from './AiDamageTab';
import { AiLabTab } from './AiLabTab';
import { AiLearningTab } from './AiLearningTab';
import { AiOverview } from './AiOverview';
import { AiSoundTab } from './AiSoundTab';
import type { Overview } from './ai.types';
import './ai.css';

const TABS = [
  { key: 'overview', icon: 'bi-speedometer2', label: 'Overview' },
  { key: 'sound', icon: 'bi-soundwave', label: 'Sound model' },
  { key: 'damage', icon: 'bi-camera', label: 'Damage model' },
  { key: 'learning', icon: 'bi-arrow-repeat', label: 'Learning' },
  { key: 'lab', icon: 'bi-flask', label: 'Test lab' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * Setup › AI performance (DAMAGE_SETTINGS): both of the damage component's models in one place - how they do in real
 * use, the live feed of AI decisions, learning from the workshop's own data, and the sound Test lab.
 */
export function AiHubPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as Tab;
  const overview = useApi<Overview>('/ai/overview');
  const go = (t: string) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  return (
    <>
      <PageHeader
        title={<span className="ai-title"><span className="ai-orb" aria-hidden="true"><i className="bi bi-cpu" /></span>AI performance</span>}
        documentTitle="AI performance"
        subtitle="How the damage and sound models do in real use, and how they learn from your technicians' decisions."
        actions={
          <button type="button" className="btn btn-light" onClick={overview.reload}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />Refresh
          </button>
        }
      />
      <div className="app-content">
        <div className="container-fluid">
          <nav className="ai-tabs" role="tablist" aria-label="AI performance sections">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : ''} onClick={() => go(t.key)}>
                <i className={`bi ${t.icon}`} aria-hidden="true" />{t.label}
              </button>
            ))}
          </nav>
          <div role="tabpanel" className="ai-panel" key={tab}>
            {tab === 'sound' ? <AiSoundTab />
              : tab === 'lab' ? <AiLabTab />
              : overview.error && !overview.data ? <ErrorState error={overview.error} onRetry={overview.reload} title="The AI figures couldn't be loaded" />
              : !overview.data ? <Card><div className="as-card-body pt-3"><Skeleton width="60%" /><div className="mt-3"><Skeleton width="100%" /></div></div></Card>
              : tab === 'damage' ? <AiDamageTab overview={overview.data} />
              : tab === 'learning' ? <AiLearningTab overview={overview.data} onChanged={overview.reload} />
              : <AiOverview data={overview.data} onTab={go} />}
          </div>
        </div>
      </div>
    </>
  );
}
