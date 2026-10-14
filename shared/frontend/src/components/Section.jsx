import styles from './Section.module.css';

export default function Section({ id, eyebrow, title, intro, tone = 'default', children }) {
  return (
    <section id={id} className={`${styles.section} ${tone === 'tint' ? styles.tint : ''}`}>
      <div className={styles.inner}>
        <header className={styles.head}>
          {eyebrow && <p className={styles.eyebrow}>{eyebrow}</p>}
          <h2 className={styles.title}>{title}</h2>
          {intro && <p className={styles.intro}>{intro}</p>}
        </header>
        {children}
      </div>
    </section>
  );
}
