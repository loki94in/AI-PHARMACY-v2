// Global Event Bus helper for UI triggers
export interface ToastEventDetail {
  message: string;
  type: 'success' | 'error' | 'info' | 'mail' | 'automation';
  link?: string;
  distributor?: string;
  qty?: string | number;
}

export const toastEvent = {
  trigger: (message: string, type: 'success' | 'error' | 'info' | 'mail' | 'automation' = 'info', link?: string, distributor?: string, qty?: string | number) => {
    window.dispatchEvent(
      new CustomEvent<ToastEventDetail>('app-show-toast', {
        detail: { message, type, link, distributor, qty },
      })
    );
  },
  subscribe: (callback: (detail: ToastEventDetail) => void) => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<ToastEventDetail>;
      callback(customEvent.detail);
    };
    window.addEventListener('app-show-toast', handler);
    return () => window.removeEventListener('app-show-toast', handler);
  },
};

export const quickOrderEvent = {
  triggerOpen: () => {
    window.dispatchEvent(new CustomEvent('app-open-quick-order'));
  },
  subscribeOpen: (callback: () => void) => {
    window.addEventListener('app-open-quick-order', callback);
    return () => window.removeEventListener('app-open-quick-order', callback);
  },
};

export interface LiveCartAddEventDetail {
  search?: string;
}

export const liveCartAddEvent = {
  triggerOpen: (search?: string) => {
    window.dispatchEvent(
      new CustomEvent<LiveCartAddEventDetail>('app-open-live-cart-add', {
        detail: { search },
      })
    );
  },
  subscribeOpen: (callback: (detail?: LiveCartAddEventDetail) => void) => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<LiveCartAddEventDetail>;
      callback(customEvent.detail);
    };
    window.addEventListener('app-open-live-cart-add', handler);
    return () => window.removeEventListener('app-open-live-cart-add', handler);
  },
};

