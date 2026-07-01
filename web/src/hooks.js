import { useState, useEffect } from 'react';

// Theo dõi breakpoint để đổi bố cục mobile <-> desktop.
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false);
  const [match, setMatch] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');
