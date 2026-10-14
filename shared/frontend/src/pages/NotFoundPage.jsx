import { Link } from 'react-router-dom';
import StatusMessage from '@/components/StatusMessage.jsx';

export default function NotFoundPage() {
  return (
    <StatusMessage>
      Page not found. <Link to="/">Back to home</Link>
    </StatusMessage>
  );
}
