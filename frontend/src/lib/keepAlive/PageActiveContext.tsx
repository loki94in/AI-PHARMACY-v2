import { createContext, useContext } from 'react';

const PageActiveContext = createContext(true);

export const PageActiveProvider = PageActiveContext.Provider;

/** True only while the calling page is the one currently visible inside KeepAliveOutlet. */
export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}
