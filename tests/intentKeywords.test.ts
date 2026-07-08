import { parseMessage } from '../src/services/intentKeywords.js';

describe('WhatsApp Intent Keywords Parsing Tests', () => {
  test('Filters out greetings and conversational noise', () => {
    // Greetings should not be treated as medicine requests
    const res1 = parseMessage('Hii');
    expect(res1.isMedicineRequest).toBe(false);
    expect(res1.medicineName).toBe('');

    const res2 = parseMessage('Hello');
    expect(res2.isMedicineRequest).toBe(false);

    const res3 = parseMessage('Good morning');
    expect(res3.isMedicineRequest).toBe(false);
  });

  test('Filters out Marathi conversational noise', () => {
    // Conversational questions in Marathi/Hindi should not be treated as medicine requests
    const res1 = parseMessage('Aahe ka aaj');
    expect(res1.isMedicineRequest).toBe(false);
    expect(res1.medicineName).toBe('');

    const res2 = parseMessage('Yevo ka');
    expect(res2.isMedicineRequest).toBe(false);
    expect(res2.medicineName).toBe('');
  });

  test('Filters out pure numeric strings', () => {
    // A standalone number should not be parsed as a medicine name
    const res1 = parseMessage('118');
    expect(res1.isMedicineRequest).toBe(false);
    expect(res1.medicineName).toBe('');
  });

  test('Correctly identifies genuine medicine requests', () => {
    // Simple medicine name without intent words
    const res1 = parseMessage('Novastat 20');
    expect(res1.isMedicineRequest).toBe(true);
    expect(res1.medicineName).toBe('Novastat 20');

    // Medicine name with quantity and intent words
    const res2 = parseMessage('need Dolo 650 2 strips');
    expect(res2.isMedicineRequest).toBe(true);
    expect(res2.medicineName).toBe('Dolo 650');
    expect(res2.quantity).toBe(2);
    expect(res2.unit).toBe('strip');
    expect(res2.rawIntentWords).toContain('need');
  });

  test('Handles medicine requests with explicit intent words even for numbers/short words', () => {
    // If there is an explicit intent word like 'send' or 'order', treat it as a request
    const res1 = parseMessage('send 118');
    expect(res1.isMedicineRequest).toBe(true);
    expect(res1.medicineName).toBe('118');
    expect(res1.rawIntentWords).toContain('send');
  });
});
