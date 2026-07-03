import { useVirtualizer as useReactVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';

export function useVirtualizer<TScrollElement extends Element, TItemElement extends Element>(
  options: Parameters<typeof useReactVirtualizer<TScrollElement, TItemElement>>[0]
) {
  return useReactVirtualizer(options);
}
