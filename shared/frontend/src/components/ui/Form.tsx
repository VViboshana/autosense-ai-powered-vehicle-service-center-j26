import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import type { PasswordPolicy } from '@/app/session';

/** A labelled input with its error message underneath. */
export function Field({ label, error, hint, required, className = '', ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`mb-3 ${className}`}>
      <label className="form-label" htmlFor={id}>
        {label}
        {required && <span className="as-required" aria-hidden="true" />}
      </label>
      <input id={id} className={`form-control${error ? ' is-invalid' : ''}`} required={required} aria-invalid={!!error} {...input} />
      {error && <div className="invalid-feedback">{error}</div>}
      {hint && !error && <div className="form-text">{hint}</div>}
    </div>
  );
}

export function SelectField({ label, error, required, children, className = '', ...select }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className={`mb-3 ${className}`}>
      <label className="form-label" htmlFor={id}>
        {label}
        {required && <span className="as-required" aria-hidden="true" />}
      </label>
      <select id={id} className={`form-select${error ? ' is-invalid' : ''}`} required={required} aria-invalid={!!error} {...select}>
        {children}
      </select>
      {error && <div className="invalid-feedback">{error}</div>}
    </div>
  );
}

/** A password input with a show/hide button. */
export function PasswordField({ label, error, problems, autoComplete = 'current-password', ...input }: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  problems?: string[];
}) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const invalid = !!error || (problems?.length ?? 0) > 0;
  return (
    <div className="mb-3">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <div className={`input-group${invalid ? ' has-validation' : ''}`}>
        <input id={id} type={shown ? 'text' : 'password'} className={`form-control${invalid ? ' is-invalid' : ''}`} autoComplete={autoComplete} {...input} />
        <button type="button" className="btn btn-light" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
          <i className={`bi ${shown ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
        </button>
        {error && <div className="invalid-feedback">{error}</div>}
        {!error && problems && problems.length > 0 && (
          <div className="invalid-feedback">
            {problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The password rules, ticked off as the user types (the server checks them again). */
export function PasswordRules({ policy, password }: { policy: PasswordPolicy; password: string }) {
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const rules = [
    { ok: password.length >= policy.minLength, text: `At least ${policy.minLength} characters` },
    { ok: types >= policy.minCharacterTypes, text: `${policy.minCharacterTypes} of: lower case, capitals, numbers, symbols` },
    { ok: null, text: `Not one of your last ${policy.rememberLast + 1} passwords` },
  ];
  return (
    <ul className="as-rules" aria-label="Password rules">
      {rules.map((r) => (
        <li key={r.text} className={r.ok ? 'ok' : ''}>
          <i className={`bi ${r.ok ? 'bi-check-circle-fill' : 'bi-circle'}`} aria-hidden="true" />
          {r.text}
        </li>
      ))}
    </ul>
  );
}

/** A coloured message box: what happened, in a sentence. */
export function Alert({ tone = 'danger', children }: { tone?: 'danger' | 'warning' | 'success' | 'info'; children: ReactNode }) {
  const icon = { danger: 'bi-exclamation-triangle', warning: 'bi-exclamation-circle', success: 'bi-check-circle', info: 'bi-info-circle' }[tone];
  return (
    <div className={`as-alert as-alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <i className={`bi ${icon}`} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
