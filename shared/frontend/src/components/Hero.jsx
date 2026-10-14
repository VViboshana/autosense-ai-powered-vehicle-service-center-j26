import styles from './Hero.module.css';

export default function Hero({ meta, hero }) {
  return (
    <section className={styles.hero}>
      <div className={styles.inner}>
        <p className={styles.eyebrow}>{meta.course}</p>
        <h1 className={styles.title}>{hero.headline}</h1>
        <p className={styles.summary}>{hero.summary}</p>
        <div className={styles.actions}>
          <a className={styles.primary} href={hero.primaryCta.href}>{hero.primaryCta.label}</a>
          <a className={styles.secondary} href={hero.secondaryCta.href}>{hero.secondaryCta.label}</a>
        </div>
        <p className={styles.meta}>
          {meta.projectName} · {meta.tagline} · Project ID {meta.projectId}
        </p>
      </div>
    </section>
  );
}
