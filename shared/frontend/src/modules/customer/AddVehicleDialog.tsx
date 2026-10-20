import { useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { Alert, Field } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ApiError, apiUpload, fieldErrors } from '@/lib/api';
import { shrinkPhoto } from './customer.ui';

/**
 * Ask the service centre to add a vehicle: its number plate and a photo (required: it is what the customer sees on
 * their home page, and it helps staff check the request). The photo is shrunk in the browser before it is sent.
 */
export function AddVehicleDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (plate: string) => void }) {
  const [plate, setPlate] = useState('');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function take(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    if (!file.type.startsWith('image/')) return setPhotoError('Choose a photo (JPEG, PNG or WebP).');
    try {
      const blob = await shrinkPhoto(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setPhotoError("This photo can't be opened here. Try a JPEG or PNG.");
    }
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!photo) return setPhotoError('Add a photo of your vehicle.');
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('registrationNo', plate);
    form.append('note', note);
    form.append('photo', photo.blob, 'vehicle.jpg');
    try {
      await apiUpload('/my/vehicle-requests', form);
      onAdded(plate.trim().toUpperCase());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const errors = fieldErrors(error);
  return (
    <Modal
      title="Add a vehicle"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-vehicle" className="btn btn-primary" disabled={busy || plate.trim().length < 4 || !photo}>
            {busy ? 'Sending…' : 'Ask to add'}
          </button>
        </>
      }
    >
      <form id="add-vehicle" onSubmit={submit} noValidate className="d-grid gap-3">
        {error instanceof ApiError && !Object.keys(errors).length && <Alert>{error.message}</Alert>}
        <label
          className={`cp-drop${over ? ' over' : ''}${photoError || errors.photo ? ' invalid' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <input type="file" accept="image/*" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} aria-describedby="photo-help" />
          {photo ? (
            <>
              <img src={photo.url} alt="Your vehicle" />
              <span className="cp-drop-change"><i className="bi bi-arrow-repeat me-1" aria-hidden="true" />Change photo</span>
            </>
          ) : (
            <span className="cp-drop-empty">
              <span className="cp-drop-ic"><i className="bi bi-camera" aria-hidden="true" /></span>
              <b>Add a photo of your car</b>
              <span className="small text-body-secondary" id="photo-help">Tap to choose one, or drop it here. A side view in daylight looks best.</span>
            </span>
          )}
        </label>
        {(photoError || errors.photo) && <div className="small text-danger mt-n2">{photoError ?? errors.photo}</div>}
        <div className="row g-2">
          <div className="col-sm-5">
            <Field
              className="cp-plate-field mb-0"
              label="Number plate"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              error={errors.registrationNo}
              placeholder="WP CAB-4521"
              autoComplete="off"
              required
            />
          </div>
          <div className="col-sm-7">
            <Field className="mb-0" label="Anything we should know? (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} placeholder="e.g. Bought it last month" />
          </div>
        </div>
        <p className="small text-body-secondary mb-0">
          The photo is shown only to you and the service centre. You can change it later.
        </p>
      </form>
    </Modal>
  );
}
