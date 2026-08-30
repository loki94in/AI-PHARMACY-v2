import { useEffect, useRef } from 'react';

// Global Keyboard Shortcut Bus and Event Manager

export interface KeyboardShortcutInfo {
  key: string;
  description: string;
  category: 'Global' | 'POS' | 'Learning' | 'CRM' | 'Purchases' | 'Settings';
}

export const SHORTCUT_DIRECTORY: KeyboardShortcutInfo[] = [
  { key: 'Ctrl + S', description: 'Save current active page form, profile, or open modal', category: 'Global' },
  { key: 'Esc', description: 'Close active open modal, popup, or overlay', category: 'Global' },
  { key: 'Ctrl + /  or  ?', description: 'Toggle Keyboard Shortcuts Cheat Sheet', category: 'Global' },
  { key: '↑ / ↓ Arrow', description: 'Switch vertically between item rows in POS & Purchases tables', category: 'POS' },
  { key: '↑ / ↓ Arrow', description: 'Switch vertically between item rows in POS & Purchases tables', category: 'Purchases' },
  { key: 'F2', description: 'Focus medicine search input in POS', category: 'POS' },
  { key: 'F4 / Ctrl + Enter', description: 'Complete & Print Sales Invoice in POS', category: 'POS' },
  { key: 'F8', description: 'Hold current POS bill', category: 'POS' },
  { key: 'Alt + N', description: 'Add new item / row in Purchases or POS', category: 'Purchases' },
  { key: 'Alt + M', description: 'Merge duplicate distributor profiles in Learning page', category: 'Learning' },
];

export const shortcutEvent = {
  triggerSave: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-trigger-save'));
    }
  },
  subscribeSave: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-trigger-save', handler);
    return () => window.removeEventListener('app-trigger-save', handler);
  },
  triggerCloseModal: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-trigger-close-modal'));
    }
  },
  subscribeCloseModal: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-trigger-close-modal', handler);
    return () => window.removeEventListener('app-trigger-close-modal', handler);
  },
  triggerToggleHelp: () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app-toggle-shortcut-help'));
    }
  },
  subscribeToggleHelp: (callback: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const handler = () => callback();
    window.addEventListener('app-toggle-shortcut-help', handler);
    return () => window.removeEventListener('app-toggle-shortcut-help', handler);
  }
};

// Centralized Modal Stack Manager for Robust Escape Key Handling
export interface ModalStackEntry {
  id: string;
  onClose: () => void | boolean;
  priority?: number;
}

const modalStack: ModalStackEntry[] = [];

export const modalManager = {
  push: (id: string, onClose: () => void | boolean, priority = 0) => {
    const existingIndex = modalStack.findIndex(m => m.id === id);
    if (existingIndex !== -1) {
      modalStack.splice(existingIndex, 1);
    }
    modalStack.push({ id, onClose, priority });
  },

  remove: (id: string) => {
    const existingIndex = modalStack.findIndex(m => m.id === id);
    if (existingIndex !== -1) {
      modalStack.splice(existingIndex, 1);
    }
  },

  hasOpenModals: (): boolean => modalStack.length > 0,

  getStackCount: (): number => modalStack.length,

  handleEscape: (): boolean => {
    // 1. Stack-based dismissal (highest priority / top-of-stack first)
    if (modalStack.length > 0) {
      let targetIndex = modalStack.length - 1;
      let maxPriority = modalStack[targetIndex]?.priority || 0;
      for (let i = modalStack.length - 1; i >= 0; i--) {
        if ((modalStack[i].priority || 0) > maxPriority) {
          maxPriority = modalStack[i].priority || 0;
          targetIndex = i;
        }
      }

      const entry = modalStack.splice(targetIndex, 1)[0];
      if (entry) {
        try {
          const result = entry.onClose();
          if (result !== false) {
            return true;
          }
        } catch (err) {
          console.error('Error invoking modal close handler on Escape:', err);
          return true;
        }
      }
    }

    // 2. DOM fallback: Dismiss any visible un-hooked modal/overlay with a close button
    if (typeof document !== 'undefined') {
      const modalOverlays = document.querySelectorAll(
        '.z-global-modal, .z-modal, [role="dialog"], [data-modal="true"], .fixed.inset-0'
      );
      if (modalOverlays.length > 0) {
        // Iterate backwards from the top-most modal in DOM order
        for (let i = modalOverlays.length - 1; i >= 0; i--) {
          const overlay = modalOverlays[i] as HTMLElement;
          if (!overlay || overlay.offsetParent === null && overlay.style.display === 'none') {
            continue;
          }
          // Find standard close button in overlay (X icon button, aria-label="Close", etc.)
          const closeBtn = overlay.querySelector<HTMLElement>(
            'button[aria-label*="close" i], button[data-close], button svg.lucide-x, button svg.lucide-x-circle'
          )?.closest('button') || overlay.querySelector<HTMLElement>('button.close-btn');

          if (closeBtn && typeof closeBtn.click === 'function') {
            closeBtn.click();
            return true;
          }
        }
      }
    }

    return false;
  }
};

/**
 * React hook to register a modal or popup with the global Escape key manager.
 * Automatically handles registration, stack ordering, and unmount cleanup.
 */
export function useModalEscape(isOpen: boolean, onClose: () => void, priority = 0) {
  const idRef = useRef<string>(`modal_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = idRef.current;
    modalManager.push(id, () => {
      onCloseRef.current();
    }, priority);

    return () => {
      modalManager.remove(id);
    };
  }, [isOpen, priority]);
}
