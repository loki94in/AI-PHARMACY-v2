import googleSearchService from '../src/services/googleSearchService.js';

describe('Google Search OCR Parser', () => {
  test('correctly parses compositions, salts, and strengths from text', () => {
    const text1 = `
      Dolo 650 Tablet is a medicine used to relieve pain and reduce fever.
      Composition: Paracetamol (650mg)
      Manufacturer: Micro Labs Ltd
      Dosage Form: Tablet
      Pack of 15 tablets
      Therapeutic Class: Analgesic / Antipyretic
    `;
    
    const parsed1 = googleSearchService.parseFieldsFromText(text1);
    
    expect(parsed1.api_reference).toBe('Paracetamol (650mg)');
    expect(parsed1.strength).toBe('650mg');
    expect(parsed1.manufacturer).toBe('Micro Labs');
    expect(parsed1.dosage_form).toBe('Tablet');
    expect(parsed1.pack_info).toBe('Pack of');
    expect(parsed1.therapeutic_class).toBe('ANALGESIC');

    const text2 = `
      Clavam 625 Tablet is an antibiotic agent containing Amoxicillin 500 mg and Clavulanic Acid 125 mg.
      Brand: Alkem Laboratories Ltd.
      Dosage: capsule
      Pack size: strip of 10 capsules
    `;
    
    const parsed2 = googleSearchService.parseFieldsFromText(text2);
    
    // Fallback detection should find Amoxicillin
    expect(parsed2.api_reference).toContain('Amoxicillin');
    expect(parsed2.strength).toBe('500 mg');
    expect(parsed2.manufacturer).toBeUndefined();
    expect(parsed2.dosage_form).toBe('Tablet');
    expect(parsed2.pack_info).toBe('strip of');
  });
});
