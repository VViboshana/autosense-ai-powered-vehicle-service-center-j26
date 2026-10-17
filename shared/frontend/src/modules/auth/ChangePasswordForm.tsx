import { useState, type FormEvent } from 'react';
import { passwordPolicy, useSession } from '@/app/session';
import { Alert, PasswordField, PasswordRules } from '@/components/ui/Form';
import { ApiError, apiSend, fieldMessages } from '@/lib/api';

/** Change your own password. Signs you out on your other devices; this one stays signed in. */
export function ChangePasswordForm() {
  const { config, me, refresh } = useSession();
  const policy = passwordPolicy(config);
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const mismatch = form.confirm.length > 0 && form.confirm !== form.next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await apiSend('POST', '/auth/change-password', { currentPassword: form.current, newPassword: form.next });
      setForm({ current: '', next: '', confirm: '' });
      setDone(true);
      if (me.mustChangePassword) await refresh();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={{ maxWidth: '26rem' }}>
      {done && <Alert tone="success">Password changed. You've been signed out on your other devices.</Alert>}
      {error instanceof ApiError && <Alert>{error.message}</Alert>}
      <PasswordField
        label="Current password"
        value={form.current}
        onChange={(e) => setForm({ ...form, current: e.target.value })}
        problems={fieldMessages(error, 'currentPassword')}
      />
      <PasswordField
        label="New password"
        value={form.next}
        onChange={(e) => setForm({ ...form, next: e.target.value })}
        problems={fieldMessages(error, 'password')}
        autoComplete="new-password"
      />
      <PasswordRules policy={policy} password={form.next} />
      <PasswordField
        label="Confirm new password"
        value={form.confirm}
        onChange={(e) => setForm({ ...form, confirm: e.target.value })}
        error={mismatch ? "The passwords don't match." : undefined}
        autoComplete="new-password"
      />
      <button type="submit" className="btn btn-primary" disabled={busy || !form.current || !form.next || mismatch}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
