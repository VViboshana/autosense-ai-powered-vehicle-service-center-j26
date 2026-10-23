/** A car driving in on a dashed road: for empty lists of vehicles ("none checked in yet"). Drawn in theme colours. */
export function DrivingCar() {
  return (
    <svg className="as-art-drive" viewBox="0 0 220 70" aria-hidden="true">
      <line className="road" x1="0" y1="62" x2="220" y2="62" />
      <g className="car">
        <path className="body" d="M74 52v-8c0-4 3-6 7-7l14-3 12-11c2-2 4-3 7-3h26c3 0 5 1 7 3l11 11 14 2c5 1 9 4 9 9v7z" />
        <path className="glass" d="M110 34l9-9h13v9zM138 25h12l8 9h-20z" />
        <circle className="wheel" cx="98" cy="54" r="8" />
        <circle className="wheel" cx="158" cy="54" r="8" />
      </g>
    </svg>
  );
}
