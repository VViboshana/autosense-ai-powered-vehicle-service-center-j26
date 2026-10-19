import { useEffect, useState } from 'react';
import './occupancy.css';

/**
 * The live picture of one bay (GET /api/occupancy/bays/:id/live.jpg), refreshed about once a second while its camera
 * is live. Each new picture is loaded off screen first and only then swapped in, so the tile never flickers blank.
 * The footage is labelled: today the only live source is a recorded video replayed as a camera (sample footage).
 */
export function LiveBayPicture({ bayId, label, everyMs = 1000 }: { bayId: number; label: string; everyMs?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () => {
      const url = `/api/occupancy/bays/${bayId}/live.jpg?t=${Date.now()}`;
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        setSrc(url);
        setFailed(false);
        timer = window.setTimeout(load, everyMs);
      };
      img.onerror = () => {
        if (!alive) return;
        setFailed(true);
        timer = window.setTimeout(load, everyMs * 3);   // not live yet, or the service is busy: try again a little later
      };
      img.src = url;
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [bayId, everyMs]);

  return (
    <div className="as-bay-live">
      {src ? <img src={src} alt={`Live camera picture of ${label}`} /> : (
        <div className="as-bay-live-wait">{failed ? 'Waiting for the camera picture…' : 'Connecting…'}</div>
      )}
      <span className="as-bay-live-tag"><i aria-hidden="true" />Live · sample footage</span>
    </div>
  );
}
