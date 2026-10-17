import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { PageHeader } from '@/layout/PageHeader';
import { ChangePasswordForm } from './ChangePasswordForm';

/** Staff: My account (who am I, change password). Open to every signed-in staff user. */
export function AccountPage() {
  const { me } = useSession();
  return (
    <>
      <PageHeader title="My account" subtitle={`${me.displayName} · ${me.role.name}`} />
      <div className="app-content">
        <div className="container-fluid">
          <div className="row g-3">
            <div className="col-lg-4">
              <Card title="Profile" icon="bi-person">
                <dl className="px-4 pb-3 mb-0 small">
                  <dt className="text-body-secondary fw-normal">Username</dt>
                  <dd className="as-mono">{me.username}</dd>
                  <dt className="text-body-secondary fw-normal">Role</dt>
                  <dd>{me.role.name}{me.isSuperAdmin ? ' · super admin' : ''}</dd>
                  {me.designation && (
                    <>
                      <dt className="text-body-secondary fw-normal">Designation</dt>
                      <dd>{me.designation}</dd>
                    </>
                  )}
                </dl>
              </Card>
            </div>
            <div className="col-lg-8">
              <Card title="Change password" icon="bi-key">
                <div className="px-4 pb-4">
                  <ChangePasswordForm />
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
