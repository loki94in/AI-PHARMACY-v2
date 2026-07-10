import { jest } from '@jest/globals';

// whatsappIntentService transitively imports the WhatsApp client — mock it out
jest.unstable_mockModule('../src/whatsappClient.js', () => ({
  __esModule: true,
  sendMessage: jest.fn(() => Promise.resolve())
}));

describe('WhatsApp Intent Confidence Gate', () => {
  let passesGate: any;

  beforeAll(async () => {
    passesGate = (await import('../src/services/whatsappIntentService.js')).passesGate;
  });

  test('bare text with no intent words needs a strong match (0.72)', () => {
    expect(passesGate(0.71, false, 'text')).toBe(false);
    expect(passesGate(0.72, false, 'text')).toBe(true);
  });

  test('intent words lower the bar to 0.60', () => {
    expect(passesGate(0.60, true, 'text')).toBe(true);
    expect(passesGate(0.59, true, 'text')).toBe(false);
  });

  test('photos (OCR) count as strong intent', () => {
    expect(passesGate(0.60, false, 'ocr')).toBe(true);
    expect(passesGate(0.60, false, 'both')).toBe(true);
    expect(passesGate(0.30, false, 'ocr')).toBe(false);
  });

  test('zero score never escalates — the chit-chat case', () => {
    expect(passesGate(0, false, 'text')).toBe(false);
    expect(passesGate(0, true, 'text')).toBe(false);
  });
});
