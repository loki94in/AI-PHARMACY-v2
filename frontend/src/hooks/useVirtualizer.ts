import { useVirtualizer as useReactVirtualizer, measureElement as defaultMeasureElement } from '@tanstack/react-virtual';
import { useEffect } from 'react';

export function useVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: Parameters<typeof useReactVirtualizer<TScrollElement, TItemElement>>[0]
) {
  const userMeasureElement = options.measureElement;

  const virtualizer = useReactVirtualizer({
    ...options,
    measureElement: (element, entry, instance) => {
      const measured = userMeasureElement
        ? userMeasureElement(element, entry, instance)
        : defaultMeasureElement(element, entry, instance);

      // If measurement is invalid (0 or negative, which happens when tab is hidden or during mounting transition),
      // fallback to estimateSize to prevent rows from collapsing to y=0.
      if (measured === undefined || measured === null || measured <= 0) {
        const index = instance.indexFromElement(element);
        return instance.options.estimateSize(index);
      }

      return measured;
    },
  });

  // Re-measure when item count changes to ensure positions remain updated
  useEffect(() => {
    if (options.count > 0) {
      virtualizer.measure();
    }
  }, [options.count, virtualizer]);

  return virtualizer;
}

