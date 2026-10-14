import { useHomeContent } from '@/hooks/useHomeContent.js';
import Hero from '@/components/Hero.jsx';
import ComponentGrid from '@/components/ComponentGrid.jsx';
import EventBus from '@/components/EventBus.jsx';
import Overview from '@/components/Overview.jsx';
import HowItWorks from '@/components/HowItWorks.jsx';
import StatusMessage from '@/components/StatusMessage.jsx';

export default function HomePage() {
  const { data, loading, error } = useHomeContent();

  if (loading) return <StatusMessage>Loading AutoSense…</StatusMessage>;
  if (error) return <StatusMessage tone="error">{error.message}</StatusMessage>;

  return (
    <>
      <Hero meta={data.meta} hero={data.hero} />
      <ComponentGrid components={data.components} />
      <EventBus events={data.events} components={data.components} />
      <Overview overview={data.overview} isSample={data.meta.isSampleData} />
      <HowItWorks steps={data.steps} />
    </>
  );
}
