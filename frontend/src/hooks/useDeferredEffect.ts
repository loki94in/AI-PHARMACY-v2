import { useEffect } from 'react';
import type { EffectCallback, DependencyList } from 'react';

export const useDeferredEffect = (effect: EffectCallback, deps: DependencyList = []) => {
  useEffect(() => {
    let cleanup: void | (() => void);
    let isCancelled = false;

    const timer = setTimeout(() => {
      if (isCancelled) return;
      cleanup = effect();
    }, 50);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (cleanup) {
        cleanup();
      }
    };
  }, deps);
};
