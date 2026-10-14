import Section from './Section.jsx';
import styles from './HowItWorks.module.css';

export default function HowItWorks({ steps }) {
  return (
    <Section
      id="how-it-works"
      tone="tint"
      eyebrow="A vehicle's journey"
      title="How AutoSense works, from arrival to pickup"
    >
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.title} className={styles.step}>
            <span className={styles.n}>{i + 1}</span>
            <h3 className={styles.title}>{s.title}</h3>
            <p className={styles.text}>{s.text}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
