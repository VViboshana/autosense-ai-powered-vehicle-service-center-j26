import { useTraceLengths } from '@/lib/useTraceLengths';

/** A saloon car from the side, facing right (the public site's drawings). Classes are styled by the parent. */
export function SideCar({ className }: { className?: string }) {
  const ref = useTraceLengths<SVGSVGElement>('.body');
  return (
    <svg ref={ref} className={className} viewBox="0 0 366 140" aria-hidden="true">
      <path className="body" d="M20 108V92c0-8 5-13 14-15l48-10 38-30c6-5 12-7 20-7h86c9 0 16 3 22 9l34 30 44 7c12 2 20 10 20 22v10c0 3-3 6-6 6H26c-3 0-6-3-6-6z" />
      <path className="glass" d="M128 66l20-24c3-3 6-4 10-4h28v28zM194 38h30c6 0 10 2 14 6l22 22h-66z" />
      <path className="lamp" d="M334 82h10v7h-10zM21 88h5v8h-5z" />
      <circle className="wheel" cx="92" cy="112" r="22" />
      <circle className="hub" cx="92" cy="112" r="10" />
      <circle className="wheel" cx="278" cy="112" r="22" />
      <circle className="hub" cx="278" cy="112" r="10" />
    </svg>
  );
}

/** The home page's picture: a car being scanned, the AI's outlines appearing, and live cards from the portal. */
export function ScanScene() {
  return (
    <div className="st-scan" role="img" aria-label="A car being inspected: the AI marks a dent, a scratch and a crack, and the owner sees the car is in Bay 2">
      <div className="st-scan-floor" />
      <SideCar className="st-scan-car" />
      <div className="st-scan-beam" />
      <div className="st-box b1"><span>Dent · moderate</span></div>
      <div className="st-box b2"><span>Scratch · minor</span></div>
      <div className="st-box b3"><span>Crack</span></div>
      <div className="st-float f1">
        <span className="ic"><i className="bi bi-tools" /></span>
        <div><b>In Bay 2</b>Your car is being serviced</div>
        <span className="dot" />
      </div>
      <div className="st-float f2">
        <span className="ic"><i className="bi bi-clipboard-check" /></span>
        <div><b>Report ready</b>3 areas, checked by a technician</div>
      </div>
      <div className="st-scan-steps" aria-hidden="true">
        <i className="done" style={{ animationDelay: '1.6s' }} />
        <i className="done" style={{ animationDelay: '1.75s' }} />
        <i className="done" style={{ animationDelay: '1.9s' }} />
        <i className="now" style={{ animationDelay: '2.05s' }} />
        <i style={{ animationDelay: '2.2s' }} />
      </div>
    </div>
  );
}
