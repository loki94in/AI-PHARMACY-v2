import { shortcutEvent, SHORTCUT_DIRECTORY } from '../frontend/src/services/keyboardShortcuts.js';

describe('Keyboard Shortcuts Event Bus Tests', () => {
  let listeners: Record<string, Function[]> = {};

  beforeAll(() => {
    (global as any).window = {
      dispatchEvent: (evt: any) => {
        const eventName = evt.type;
        if (listeners[eventName]) {
          listeners[eventName].forEach(fn => fn(evt));
        }
      },
      addEventListener: (eventName: string, handler: Function) => {
        if (!listeners[eventName]) listeners[eventName] = [];
        listeners[eventName].push(handler);
      },
      removeEventListener: (eventName: string, handler: Function) => {
        if (listeners[eventName]) {
          listeners[eventName] = listeners[eventName].filter(h => h !== handler);
        }
      }
    };
    (global as any).CustomEvent = class CustomEvent {
      type: string;
      detail: any;
      constructor(type: string, opts?: any) {
        this.type = type;
        this.detail = opts?.detail;
      }
    };
  });

  afterAll(() => {
    delete (global as any).window;
    delete (global as any).CustomEvent;
  });

  it('should contain global shortcuts in directory', () => {
    const saveShortcut = SHORTCUT_DIRECTORY.find((s: any) => s.key === 'Ctrl + S');
    expect(saveShortcut).toBeDefined();
    expect(saveShortcut?.category).toBe('Global');

    const escShortcut = SHORTCUT_DIRECTORY.find((s: any) => s.key === 'Esc');
    expect(escShortcut).toBeDefined();
  });

  it('should trigger and receive save shortcut event', () => {
    let triggered = false;
    const unsub = shortcutEvent.subscribeSave(() => {
      triggered = true;
    });

    shortcutEvent.triggerSave();
    expect(triggered).toBe(true);

    unsub();
  });

  it('should trigger and receive close modal event', () => {
    let triggered = false;
    const unsub = shortcutEvent.subscribeCloseModal(() => {
      triggered = true;
    });

    shortcutEvent.triggerCloseModal();
    expect(triggered).toBe(true);

    unsub();
  });

  it('should trigger and receive toggle help event', () => {
    let triggered = false;
    const unsub = shortcutEvent.subscribeToggleHelp(() => {
      triggered = true;
    });

    shortcutEvent.triggerToggleHelp();
    expect(triggered).toBe(true);

    unsub();
  });
});
