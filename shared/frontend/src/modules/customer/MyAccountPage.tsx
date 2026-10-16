import { useEffect } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { ChangePasswordForm } from '@/modules/auth/ChangePasswordForm';

/** Customer: My account (details and password). */
export function MyAccountPage() {
  const { me, signOut } = useSession();
  useEffect(() => {
    document.title = 'My account · AutoSense';
  }, []);
  return (
    <>
      <h1 className="as-page-title mb-3">My account</h1>
      <Card title="Your details" icon="bi-person" className="mb-3">
        <dl className="row small px-4 pb-3 mb-0">
          <dt className="col-sm-4 text-body-secondary fw-normal">Name</dt>
          <dd className="col-sm-8">{me.displayName}</dd>
          <dt className="col-sm-4 text-body-secondary fw-normal">Mobile number (sign-in)</dt>
          <dd className="col-sm-8 as-mono">{me.username}</dd>
        </dl>
        <p className="small text-body-secondary px-4 pb-3 mb-0">To change your name or number, ask the service centre.</p>
      </Card>
      <Card title="Change password" icon="bi-key" className="mb-3">
        <div className="px-4 pb-4">
          <ChangePasswordForm />
        </div>
      </Card>
      <button type="button" className="btn btn-light" onClick={() => void signOut()}>
        <i className="bi bi-box-arrow-right me-1" aria-hidden="true" />
        Sign out
      </button>
    </>
  );
}
