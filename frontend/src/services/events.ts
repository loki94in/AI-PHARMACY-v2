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
  qty?: number;
  sourceOrderId?: number;
  sourceRefillId?: number;
}

export const liveCartAddEvent = {
  triggerOpen: (search?: string, qty?: number, sourceOrderId?: number, sourceRefillId?: number) => {
    window.dispatchEvent(
      new CustomEvent<LiveCartAddEventDetail>('app-open-live-cart-add', {
        detail: { search, qty, sourceOrderId, sourceRefillId },
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

export const refillEvent = {
  triggerRefresh: () => {
    window.dispatchEvent(new CustomEvent('refresh-refills'));
    window.dispatchEvent(new CustomEvent('app-refills-updated'));
  },
  subscribeRefresh: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('refresh-refills', handler);
    window.addEventListener('app-refills-updated', handler);
    return () => {
      window.removeEventListener('refresh-refills', handler);
      window.removeEventListener('app-refills-updated', handler);
    };
  },
};

// Fired whenever a special order is created or updated so PharmarackCart
// can invalidate its module-level cache and re-fetch without a page reload.
export const specialOrdersEvent = {
  triggerUpdated: () => window.dispatchEvent(new CustomEvent('app-special-orders-updated')),
  subscribeUpdated: (callback: () => void) => {
    window.addEventListener('app-special-orders-updated', callback);
    return () => window.removeEventListener('app-special-orders-updated', callback);
  },
};

// Global event bus helper for WhatsApp Queue live drawer & status triggers
export const whatsappQueueEvent = {
  triggerOpen: () => {
    window.dispatchEvent(new CustomEvent('app-open-wa-queue'));
  },
  triggerUpdated: () => {
    window.dispatchEvent(new CustomEvent('app-wa-queue-updated'));
  },
  subscribeOpen: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-open-wa-queue', handler);
    return () => window.removeEventListener('app-open-wa-queue', handler);
  },
  subscribeUpdated: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-wa-queue-updated', handler);
    return () => window.removeEventListener('app-wa-queue-updated', handler);
  },
};

// Global event bus helper for the WhatsApp Automation Hub entry point in the header
export const automationHubEvent = {
  triggerOpen: () => {
    window.dispatchEvent(new CustomEvent('app-open-automation-hub'));
  },
  triggerUpdated: () => {
    window.dispatchEvent(new CustomEvent('app-automation-hub-updated'));
  },
  subscribeOpen: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-open-automation-hub', handler);
    return () => window.removeEventListener('app-open-automation-hub', handler);
  },
  subscribeUpdated: (callback: () => void) => {
    const handler = () => callback();
    window.addEventListener('app-automation-hub-updated', handler);
    return () => window.removeEventListener('app-automation-hub-updated', handler);
  },
};

export interface MessageSendProgressDetail {
  recipient: string;
  messagePreview?: string;
  durationSec?: number;
  id?: string;
}

export const messageSendEvent = {
  triggerSendProgress: (recipient: string, messagePreview?: string, durationSec = 10) => {
    window.dispatchEvent(
      new CustomEvent<MessageSendProgressDetail>('app-message-send-progress', {
        detail: { recipient, messagePreview, durationSec, id: `msg-${Date.now()}` },
      })
    );
  },
  subscribeSendProgress: (callback: (detail: MessageSendProgressDetail) => void) => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<MessageSendProgressDetail>;
      callback(customEvent.detail);
    };
    window.addEventListener('app-message-send-progress', handler);
    return () => window.removeEventListener('app-message-send-progress', handler);
  },
};



