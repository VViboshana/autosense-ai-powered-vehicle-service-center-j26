import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p><strong>AutoSense</strong> · IT4010 Research Project · Sri Lanka Institute of Information Technology</p>
        <p className={styles.muted}>© {new Date().getFullYear()} AutoSense research team. For academic use.</p>
      </div>
    </footer>
  );
}
