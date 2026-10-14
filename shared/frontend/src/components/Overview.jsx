import Section from './Section.jsx';
import styles from './Overview.module.css';

const bayLabel = { busy: 'In service', waiting: 'Awaiting pickup', free: 'Free' };

export default function Overview({ overview, isSample }) {
  const updated = new Date(overview.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <Section
      id="overview"
      eyebrow="Service centre overview"
      title="What staff will see at a glance"
      intro={`Snapshot at ${updated}. This panel will update live once the components publish real events.`}
    >
      {isSample && (
        <p className={styles.sample} role="note">
          Sample data — not from a real service centre.
        </p>
      )}

      <div className={styles.stats}>
        {overview.stats.map((s) => (
          <div key={s.id} className={styles.stat}>
            <span className={styles.value}>
              {s.value}
              {s.total != null && <small>/{s.total}</small>}
              {s.unit && <small> {s.unit}</small>}
            </span>
            <span className={styles.label}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.panels}>
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Bays</h3>
          <ul className={styles.bays}>
            {overview.bays.map((b) => (
              <li key={b.id} className={`${styles.bay} ${styles[b.status]}`}>
                <span className={styles.bayId}>{b.id}</span>
                <span className={styles.bayStatus}>{bayLabel[b.status]}</span>
                {b.vehicle && <span className={styles.bayVehicle}>{b.vehicle} · {b.job}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Recent security alerts</h3>
          <ul className={styles.alerts}>
            {overview.recentAlerts.map((a) => (
              <li key={a.id} className={styles.alert}>
                <span className={`${styles.sev} ${styles[`sev_${a.severity}`]}`}>{a.severity}</span>
                <div className={styles.alertBody}>
                  <strong>{a.threat}</strong>
                  <span>Bay {a.bay} · affects {a.affected} · {a.time}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
