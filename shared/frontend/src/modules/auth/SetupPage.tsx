import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { passwordPolicy, useAuth } from '@/app/session';
import { Alert, Field, PasswordField, PasswordRules } from '@/components/ui/Form';
import { ApiError, apiSend, fieldErrors, fieldMessages } from '@/lib/api';
import { AuthShell } from './AuthShell';

/**
 * First run: shown only while there is no staff account at all. Creates the first System administrator (super admin)
 * and signs them in. After that this page never appears again; the administrator adds everyone else in Users.
 */
export function SetupPage() {
  const { config, refresh } = useAuth();
  const navigate = useNavigate();
  const policy = passwordPolicy(config);
  const [form, setForm] = useState({ setupKey: '', username: '', firstName: '', lastName: '', email: '', password: '', confirm: '' });
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
      const { confirm: _confirm, ...body } = form;
      await apiSend('POST', '/auth/setup', body);
      await refresh();
      navigate('/admin/users', { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
      if (err instanceof ApiError && err.code === 'SETUP_DONE') await refresh();
    }
  }

  return (
    <AuthShell title="Set up AutoSense">
      <h2>Set up AutoSense</h2>
      <p className="text-body-secondary mb-4">
        Create the System administrator account. It can use every screen and add your team in Administration › Users.
      </p>
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <form onSubmit={submit} noValidate>
        {config.setup.keyRequired && (
          <PasswordField label="Setup key" value={form.setupKey} onChange={set('setupKey')} problems={fieldMessages(error, 'setupKey')} autoComplete="off" />
        )}
        <Field label="Username" value={form.username} onChange={set('username')} error={fields.username} hint="You'll sign in with this, e.g. manodya.admin" autoComplete="username" autoFocus required />
        <div className="row g-2">
          <div className="col-sm-6"><Field label="First name" value={form.firstName} onChange={set('firstName')} error={fields.firstName} autoComplete="given-name" required /></div>
          <div className="col-sm-6"><Field label="Last name" value={form.lastName} onChange={set('lastName')} error={fields.lastName} autoComplete="family-name" /></div>
        </div>
        <Field label="Email (optional)" type="email" value={form.email} onChange={set('email')} error={fields.email} autoComplete="email" />
        <PasswordField label="Password" value={form.password} onChange={set('password')} problems={fieldMessages(error, 'password')} autoComplete="new-password" />
        <PasswordRules policy={policy} password={form.password} />
        <PasswordField label="Confirm password" value={form.confirm} onChange={set('confirm')} error={mismatch ? "The passwords don't match." : undefined} autoComplete="new-password" />
        <button
          type="submit"
          className="btn btn-primary w-100"
          disabled={busy || !form.username || !form.firstName || !form.password || mismatch || (config.setup.keyRequired && !form.setupKey)}
        >
          {busy ? 'Creating…' : 'Create administrator'}
        </button>
      </form>
      <p className="mt-4 mb-0 small text-body-secondary">This page is only shown until the first administrator exists.</p>
    </AuthShell>
  );
}
