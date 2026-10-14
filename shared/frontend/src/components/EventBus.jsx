import Section from './Section.jsx';
import styles from './EventBus.module.css';

export default function EventBus({ events, components }) {
  const label = (id) => `C${components.find((c) => c.id === id)?.number ?? '?'}`;

  return (
    <Section
      id="event-bus"
      tone="tint"
      eyebrow="Shared event bus"
      title="Components talk through four events"
      intro="Each component publishes what it knows. Others subscribe only to what they need, so any component can be developed and tested on its own."
    >
      <ul className={styles.list}>
        {events.map((e) => (
          <li key={e.name} className={styles.row}>
            <div className={styles.flow} aria-label={`${e.name} from ${label(e.from)}`}>
              <span className={styles.node}>{label(e.from)}</span>
              <span className={styles.arrow} aria-hidden="true">→</span>
              <code className={styles.event}>{e.name}</code>
              <span className={styles.arrow} aria-hidden="true">→</span>
              {e.to.length ? (
                e.to.map((t) => <span key={t} className={styles.node}>{label(t)}</span>)
              ) : (
                <span className={`${styles.node} ${styles.out}`}>Staff &amp; customers</span>
              )}
            </div>
            <p className={styles.desc}>{e.description}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
