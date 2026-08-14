import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const scrollPositions = new Map<string, number>();

/**
 * Custom hook to restore container scroll offsets per route path on mount.
 */
export function useScrollRestore<T extends HTMLElement = HTMLDivElement>() {
  const location = useLocation();
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Restore scroll position immediately after mount
    const saved = scrollPositions.get(location.pathname);
    if (saved !== undefined) {
      el.scrollTop = saved;
    }

    const handleScroll = () => {
      scrollPositions.set(location.pathname, el.scrollTop);
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      // Save final scroll position on unmount
      scrollPositions.set(location.pathname, el.scrollTop);
      el.removeEventListener('scroll', handleScroll);
    };
  }, [location.pathname]);

  return ref;
}
