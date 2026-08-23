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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- generic passthrough hook; caller owns the dependency list
  }, deps);
};
