import Section from './Section.jsx';
import styles from './ComponentGrid.module.css';

export default function ComponentGrid({ components }) {
  return (
    <Section
      id="components"
      eyebrow="Four AI components"
      title="Each component solves one service-centre problem"
      intro="The components are built and trained separately, then connected through shared events."
    >
      <div className={styles.grid}>
        {components.map((c) => (
          <article key={c.id} className={styles.card}>
            <div className={styles.top}>
              <span className={styles.num}>C{c.number}</span>
              <span className={styles.status}>{c.status}</span>
            </div>
            <h3 className={styles.name}>{c.name}</h3>
            <p className={styles.summary}>{c.summary}</p>
            <dl className={styles.facts}>
              <div><dt>Publishes</dt><dd><code>{c.publishes}</code></dd></div>
              <div>
                <dt>Uses</dt>
                <dd>{c.consumes.length ? c.consumes.map((e) => <code key={e}>{e}</code>) : '—'}</dd>
              </div>
              <div><dt>Owner</dt><dd>{c.owner}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </Section>
  );
}
