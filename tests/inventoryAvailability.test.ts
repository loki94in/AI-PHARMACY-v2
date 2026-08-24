import { jest } from '@jest/globals';

// whatsappIntentService transitively imports the WhatsApp client — mock the
// full export surface it (and its transitive imports) touch.
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve({ success: true })),
  getWhatsAppStatus: jest.fn(() => Promise.resolve({ isReady: true, initializing: false, isSyncing: false })),
  isReady: true,
  currentQr: null,
  shouldRouteToBusiness: jest.fn(() => Promise.resolve(false)),
  initClient: jest.fn(() => Promise.resolve(null)),
  destroyClient: jest.fn(() => Promise.resolve()),
  forceReconnect: jest.fn(() => Promise.resolve()),
  reconnectClient: jest.fn(() => Promise.resolve()),
  hasSavedSession: jest.fn(() => true),
  isWhatsAppExplicitlyDisabled: jest.fn(() => Promise.resolve(false)),
  waitForWhatsAppReady: jest.fn(() => Promise.resolve(true)),
  markWhatsAppActivity: jest.fn(),
  isPuppeteerDetachedError: jest.fn(() => false),
  setCurrentQr: jest.fn(),
  setIsReady: jest.fn(),
  normalizeWhatsAppPhone: (phone: string) => String(phone).replace(/\D/g, ''),
  hashMessageBody: (msg: string) => String(msg).length,
  getChats: jest.fn(() => Promise.resolve([])),
  getChatMessages: jest.fn(() => Promise.resolve([])),
  getMessageMedia: jest.fn(() => Promise.resolve(undefined))
}));

describe('Inventory availability classification (stock vs master-DB vs external-only)', () => {
  let service: any;

  beforeAll(async () => {
    service = await import('../src/services/whatsappIntentService.js');
  });

  describe('resolveInventoryStock', () => {
    test('maps lowercased medicine names to summed active stock', async () => {
      const fakeDb = {
        all: jest.fn(async (_sql: string, params: string[]) =>
          params.map((p: string) => ({ name: 'DOLO 650', total_stock: p === 'dolo 650' ? 12 : 0 }))
        )
      };
      const stock = await service.resolveInventoryStock(['Dolo 650'], fakeDb);
      expect(stock['dolo 650']).toBe(12);
    });

    test('returns empty map for empty input without querying', async () => {
      const fakeDb = { all: jest.fn() };
      const stock = await service.resolveInventoryStock([], fakeDb);
      expect(stock).toEqual({});
      expect(fakeDb.all).not.toHaveBeenCalled();
    });
  });

  describe('classifyAvailability', () => {
    test('no local matches → EXTERNAL_ONLY (image/catalog only)', () => {
      expect(service.classifyAvailability([], { 'dolo 650': 12 })).toBe('EXTERNAL_ONLY');
    });

    test('local match with active stock → IN_STOCK', () => {
      expect(service.classifyAvailability(['Dolo 650'], { 'dolo 650': 5 })).toBe('IN_STOCK');
    });

    test('local match with ZERO stock → REGISTERED_NO_STOCK (never claim available)', () => {
      expect(service.classifyAvailability(['Dolo 650'], { 'dolo 650': 0 })).toBe('REGISTERED_NO_STOCK');
      expect(service.classifyAvailability(['Dolo 650'], {})).toBe('REGISTERED_NO_STOCK');
    });

    test('best stock across multiple matches wins', () => {
      expect(service.classifyAvailability(['Telma 40', 'Dolo 650'], { 'telma 40': 0, 'dolo 650': 3 })).toBe('IN_STOCK');
    });
  });
});
