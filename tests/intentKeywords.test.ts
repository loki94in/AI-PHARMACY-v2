import { parseMessage, isPlausibleMedicineName } from '../src/services/intentKeywords.js';

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

  test('Intent words NEVER resurrect an invalid medicine name (production "118" leak)', () => {
    // "send 118" is a request, but "118" must not be searched as a medicine
    const res1 = parseMessage('send 118');
    expect(res1.medicineName).toBe('');
    expect(res1.rawIntentWords).toContain('send');

    // "118 do" was the observed leak ('do' used to be an intent word)
    const res2 = parseMessage('118 do');
    expect(res2.medicineName).toBe('');
  });

  test('Filters out Marathi conversational leaks observed in production', () => {
    for (const text of ['Asudet', 'Baki aahet ना', 'Aahe ka aaj', 'Yevo ka', 'thik aahe', 'kadhi milel']) {
      const res = parseMessage(text);
      expect(res.medicineName).toBe('');
    }
  });

  test('Genuine medicine names still pass with new intent words', () => {
    const res1 = parseMessage('pathva Telma 40');
    expect(res1.isMedicineRequest).toBe(true);
    expect(res1.medicineName).toBe('Telma 40');
    expect(res1.rawIntentWords).toContain('pathva');
  });

  describe('isPlausibleMedicineName', () => {
    test('rejects numbers, punctuation, short and Devanagari-only strings', () => {
      expect(isPlausibleMedicineName('118')).toBe(false);
      expect(isPlausibleMedicineName('118 2')).toBe(false);
      expect(isPlausibleMedicineName('12.5')).toBe(false);
      expect(isPlausibleMedicineName('ab')).toBe(false);
      expect(isPlausibleMedicineName('ना')).toBe(false);
      expect(isPlausibleMedicineName('बाकी आहेत')).toBe(false);
      expect(isPlausibleMedicineName('')).toBe(false);
    });

    test('rejects strings made entirely of noise words', () => {
      expect(isPlausibleMedicineName('baki aahet')).toBe(false);
      expect(isPlausibleMedicineName('asudet')).toBe(false);
    });

    test('accepts real medicine names', () => {
      expect(isPlausibleMedicineName('Novastat 20')).toBe(true);
      expect(isPlausibleMedicineName('AB Phylline')).toBe(true);
      expect(isPlausibleMedicineName('Dolo 650')).toBe(true);
    });
  });
});
