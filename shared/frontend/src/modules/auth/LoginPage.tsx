import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/app/session';
import { Alert, Field, PasswordField } from '@/components/ui/Form';
import { ApiError, apiSend } from '@/lib/api';
import { AuthShell } from './AuthShell';

/** One sign-in page for staff and customers; each lands on their own side of the app. */
export function LoginPage() {
  const { refresh, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = new URLSearchParams(location.search).get('next');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/auth/login', { username, password });
      await refresh();
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <h2>Sign in</h2>
      <p className="text-body-secondary mb-4">Staff: use your username. Customers: use your mobile number.</p>
      {notice && !error && <Alert tone="info">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field
          label="Username or mobile number"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <PasswordField label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" className="btn btn-primary w-100" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 mb-0 small text-body-secondary">
        New customer? <Link to="/register">Create an account</Link> to follow your vehicle.
        <br />
        Forgot your password? Staff: ask your administrator. Customers: ask the service centre.
      </p>
    </AuthShell>
  );
}
