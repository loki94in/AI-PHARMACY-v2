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
