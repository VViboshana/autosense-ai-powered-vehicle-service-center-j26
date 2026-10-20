import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { passwordPolicy, useAuth } from '@/app/session';
import { Alert, Field, PasswordField, PasswordRules } from '@/components/ui/Form';
import { ApiError, apiSend, fieldErrors, fieldMessages } from '@/lib/api';
import { AuthShell } from './AuthShell';

/** Customer self sign-up. After signing up the customer asks to link their vehicle; staff approve it. */
export function RegisterPage() {
  const { refresh, config } = useAuth();
  const navigate = useNavigate();
  const policy = passwordPolicy(config);
  // Where to go after signing up, e.g. the booking form from "Book this service" (portal addresses only)
  const nextParam = useSearchParams()[0].get('next');
  const next = nextParam?.startsWith('/my') ? nextParam : '/my';

  const [form, setForm] = useState({ fullName: '', mobile: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });
  const fields = fieldErrors(error);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/auth/register', { fullName: form.fullName, mobile: form.mobile, email: form.email, password: form.password });
      await refresh();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create an account">
      <h2>Create an account</h2>
      <p className="text-body-secondary mb-4">Follow your vehicle's service, inspection reports and recommendations.</p>
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form onSubmit={submit} noValidate>
        <Field label="Full name" value={form.fullName} onChange={set('fullName')} error={fields.fullName} autoComplete="name" required />
        <Field
          label="Mobile number"
          value={form.mobile}
          onChange={set('mobile')}
          error={fields.mobile}
          inputMode="tel"
          autoComplete="tel"
          placeholder="07X XXX XXXX"
          hint="You'll sign in with this number."
          required
        />
        <Field label="Email (optional)" type="email" value={form.email} onChange={set('email')} error={fields.email} autoComplete="email" />
        <PasswordField
          label="Password"
          value={form.password}
          onChange={set('password')}
          problems={fieldMessages(error, 'password')}
          autoComplete="new-password"
        />
        <PasswordRules policy={policy} password={form.password} />
        <PasswordField
          label="Confirm password"
          value={form.confirm}
          onChange={set('confirm')}
          error={mismatch ? "The passwords don't match." : undefined}
          autoComplete="new-password"
        />
        <p className="small text-body-secondary">
          By creating an account you agree to our <Link to="/terms">terms of use</Link> and <Link to="/privacy">privacy notice</Link>.
        </p>
        <button type="submit" className="btn btn-primary w-100" disabled={busy || !form.fullName || !form.mobile || !form.password || mismatch}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 mb-0 small text-body-secondary">
        Already have an account? <Link to={nextParam ? `/login?next=${encodeURIComponent(next)}` : '/login'}>Sign in</Link>
      </p>
    </AuthShell>
  );
}
