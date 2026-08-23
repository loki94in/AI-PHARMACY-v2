import { api } from './api';

export interface StagedItem {
  id: number;
  type: 'sales' | 'purchases' | 'special_order';
  patient_name?: string;
  patient_phone?: string;
  doctor_name?: string;
  discount?: number;
  payment_medium?: string;
  total_amount?: number;
  items_json?: string | unknown[];
  items?: unknown[];
  product?: string;
  qty?: number;
  priority?: string;
  requester?: string;
}

let activeQueue: StagedItem[] = [];
let currentIndex = 0;
let isQueueActive = false;

const emitUpdate = () => {
  window.dispatchEvent(
    new CustomEvent('staged-queue-updated', {
      detail: {
        queue: activeQueue,
        currentIndex,
        isActive: isQueueActive,
        currentItem: isQueueActive ? activeQueue[currentIndex] : null,
      },
    })
  );
};

const clearQueueImpl = () => {
  activeQueue = [];
  currentIndex = 0;
  isQueueActive = false;
  emitUpdate();
};

const getCurrentItemImpl = (): StagedItem | null => {
  if (!isQueueActive || activeQueue.length === 0) return null;
  return activeQueue[currentIndex] || null;
};

const getQueueStateImpl = () => ({
  queue: activeQueue,
  currentIndex,
  isActive: isQueueActive,
  total: activeQueue.length,
  currentItem: isQueueActive ? activeQueue[currentIndex] : null,
});

export const stagedQueueService = {
  startQueue: (items: StagedItem[], startIndex = 0) => {
    activeQueue = items;
    currentIndex = Math.min(Math.max(0, startIndex), items.length - 1);
    isQueueActive = items.length > 0;
    emitUpdate();
  },

  getCurrentItem: getCurrentItemImpl,

  getQueueState: getQueueStateImpl,

  nextItem: () => {
    if (currentIndex < activeQueue.length - 1) {
      currentIndex++;
      emitUpdate();
      return activeQueue[currentIndex];
    } else {
      // Reached end of queue
      clearQueueImpl();
      return null;
    }
  },

  prevItem: () => {
    if (currentIndex > 0) {
      currentIndex--;
      emitUpdate();
      return activeQueue[currentIndex];
    }
    return activeQueue[currentIndex] || null;
  },

  clearQueue: clearQueueImpl,

  removeById: (id: number) => {
    const idx = activeQueue.findIndex(item => item.id === id);
    if (idx === -1) return;
    activeQueue = activeQueue.filter((_, i) => i !== idx);
    if (activeQueue.length === 0) {
      clearQueueImpl();
      return;
    }
    if (currentIndex >= activeQueue.length) {
      currentIndex = activeQueue.length - 1;
    }
    emitUpdate();
  },

  approveCurrentAndNext: async () => {
    const current = getCurrentItemImpl();
    if (!current) return null;

    try {
      if (current.type === 'sales') {
        const items = typeof current.items_json === 'string'
          ? JSON.parse(current.items_json)
          : (current.items_json || current.items || []);

        await api.approveStagedSale(current.id, {
          items,
          patient_name: current.patient_name,
          patient_phone: current.patient_phone,
          discount: Number(current.discount || 0),
        });
      }
    } catch (err) {
      console.warn('Failed to approve staged item on auto-advance:', err);
    }

    // Remove approved item from queue and advance
    activeQueue = activeQueue.filter((_, idx) => idx !== currentIndex);
    if (activeQueue.length === 0) {
      clearQueueImpl();
      return null;
    }

    if (currentIndex >= activeQueue.length) {
      currentIndex = activeQueue.length - 1;
    }

    emitUpdate();
    return activeQueue[currentIndex] || null;
  },

  subscribe: (callback: (state: ReturnType<typeof getQueueStateImpl>) => void) => {
    const handler = () => callback(getQueueStateImpl());
    window.addEventListener('staged-queue-updated', handler);
    return () => window.removeEventListener('staged-queue-updated', handler);
  },
};
