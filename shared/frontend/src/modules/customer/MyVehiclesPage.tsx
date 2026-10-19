import { useEffect, useState, type CSSProperties } from 'react';
import { useSession } from '@/app/session';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { apiSend, apiUpload } from '@/lib/api';
import { formatDate, localHour } from '@/lib/format';
import { useApi } from '@/lib/useApi';
import { Toasts } from '@/modules/inspections/Toasts';
import { useToasts } from '@/modules/inspections/useToasts';
import { AddVehicleDialog } from './AddVehicleDialog';
import { CarArt, PlateText } from './art';
import type { MyVehicles } from './customer.types';
import { shrinkPhoto } from './customer.ui';
import { VehicleHero } from './VehicleHero';
import './customer.css';
import '@/modules/inspections/inspections.css';

const greeting = (h: number) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

/**
 * The customer's home: their vehicles as photo cards with the visit on top (the one at the service centre first, large),
 * a tile to add a vehicle, and requests waiting for the service centre.
 */
export function MyVehiclesPage() {
  const { me } = useSession();
  const data = useApi<MyVehicles>('/my/vehicles', undefined, { refreshMs: 60_000 });
  const [adding, setAdding] = useState(false);
  const { toasts, show } = useToasts();

  useEffect(() => {
    document.title = 'My vehicles · AutoSense';
  }, []);

  async function cancel(claimId: number) {
    await apiSend('DELETE', `/my/vehicle-requests/${claimId}`).catch(() => undefined);
    data.reload();
  }

  async function changePhoto(vehicleId: number, file: File) {
    try {
      const form = new FormData();
      form.append('photo', await shrinkPhoto(file), 'vehicle.jpg');
      await apiUpload(`/my/vehicles/${vehicleId}/photo`, form);
      data.reload();
      show('Photo updated');
    } catch {
      show("The photo couldn't be changed. Try a JPEG or PNG.", 'info');
    }
  }

  const [first, ...others] = data.data?.vehicles ?? [];
  const requests = data.data?.requests ?? [];

  return (
    <>
      <div className="mb-3 cp-rise">
        <div className="cp-eyebrow">My vehicles</div>
        <h1 className="cp-title">{greeting(localHour())}, {me.displayName.split(' ')[0]}</h1>
        <div className="text-body-secondary">Follow your vehicle's visit and see what the inspection found.</div>
      </div>

      <div className="cp-home">
        <div className="cp-home-main">
          {data.error && !data.data ? (
            <Card><ErrorState inline error={data.error} onRetry={data.reload} /></Card>
          ) : !data.data ? (
            <div className="cp-hero d-grid align-content-end p-4 gap-2"><Skeleton width="40%" /><Skeleton width="60%" /></div>
          ) : !first ? (
            <Card>
              <EmptyState icon="bi-car-front" title="No vehicles yet" action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>Add a vehicle</button>}>
                Add your vehicle's number plate and a photo. The service centre confirms it's yours, then you can follow its service here.
              </EmptyState>
            </Card>
          ) : (
            <>
              <div className="cp-rise" style={{ '--i': 1 } as CSSProperties}>
                <VehicleHero v={first} big onChangePhoto={(f) => changePhoto(first.vehicleId, f)} />
              </div>
              {others.length > 0 && (
                <div className="cp-others">
                  {others.map((v, i) => (
                    <div key={v.vehicleId} className="cp-rise" style={{ '--i': i + 2 } as CSSProperties}>
                      <VehicleHero v={v} big={false} onChangePhoto={(f) => changePhoto(v.vehicleId, f)} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="cp-home-side">
          <button type="button" className="cp-add cp-rise" style={{ '--i': 2 } as CSSProperties} onClick={() => setAdding(true)}>
            <span className="plus" aria-hidden="true">+</span>
            <b>Add a vehicle</b>
            <span className="small">Its number plate and a photo. The service centre confirms it's yours.</span>
          </button>
          {requests.map((r) => (
            <div key={r.claimId} className="cp-pend">
              <div className="cp-pend-img">
                {r.photoUrl ? <img src={r.photoUrl} alt="" /> : <CarArt />}
                {r.status === 'pending' && <span className="cp-shimmer" aria-hidden="true" />}
                <span className={`cp-pill cp-tone-${r.status === 'pending' ? 'warning' : 'muted'}`}>
                  {r.status === 'pending' ? 'Waiting for the service centre' : 'Not approved'}
                </span>
              </div>
              <div className="cp-pend-b">
                <div className="cp-pend-row">
                  <span className="cp-plate"><PlateText plate={r.registrationNo} /></span>
                  {r.status === 'pending' && <button type="button" className="cp-link" onClick={() => void cancel(r.claimId)}>Cancel request</button>}
                </div>
                <span className="small text-body-secondary">
                  {r.status === 'pending' ? `Asked on ${formatDate(r.requestedAt)}. It appears here once they confirm it, usually at your next visit.` : r.reviewNote ? `Reason: ${r.reviewNote}` : 'The service centre could not confirm this vehicle.'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {adding && (
        <AddVehicleDialog
          onClose={() => setAdding(false)}
          onAdded={(plate) => {
            setAdding(false);
            show(`Sent. The service centre will confirm ${plate} is yours.`);
            data.reload();
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}
