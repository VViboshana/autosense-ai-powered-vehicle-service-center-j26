export default function StatusMessage({ tone = 'info', children }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{ maxWidth: 'var(--max-w)', margin: '0 auto', padding: '5rem var(--gutter)', textAlign: 'center',
        color: tone === 'error' ? 'var(--bad)' : 'var(--muted)' }}
    >
      {children}
    </div>
  );
}
