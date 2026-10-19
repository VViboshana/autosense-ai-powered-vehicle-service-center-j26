import { Link } from 'react-router-dom';
import logo from '@/assets/autosense-logo.png';

/**
 * The AutoSense logo (crossed wrenches, "AUTO / SENSE"), linking home. White on transparent: for the dark
 * backgrounds of the sidebar, the sign-in brand panel and the customer top bar.
 * The source artwork is kept outside the repo; this is a trimmed copy at 3x its largest display height.
 */
export function Brand({ to = '/', height = 40 }: { to?: string; height?: number }) {
  return (
    <Link to={to} className="as-brand" aria-label="AutoSense home">
      <img src={logo} alt="AutoSense" height={height} style={{ height, width: 'auto' }} />
    </Link>
  );
}
