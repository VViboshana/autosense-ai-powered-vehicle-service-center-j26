import { useEffect, useState } from 'react';
import { getHomeContent } from '@/services/homeService.js';

export function useHomeContent() {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let active = true;
    getHomeContent()
      .then((data) => active && setState({ data, loading: false, error: null }))
      .catch((error) => active && setState({ data: null, loading: false, error }));
    return () => {
      active = false;
    };
  }, []);

  return state;
}
