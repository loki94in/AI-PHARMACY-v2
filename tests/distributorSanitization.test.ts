import { isValidDistributorName, sanitizeDistributorName } from '../src/utils/nameNormalizer.js';

describe('Distributor Name Sanitization Tests', () => {
  it('should reject email addresses as distributor names', () => {
    expect(isValidDistributorName('ctinvoice@gmail.com')).toBe(false);
    expect(isValidDistributorName('supplier@pharma.co.in')).toBe(false);
    expect(sanitizeDistributorName('ctinvoice@gmail.com')).toBe('');
  });

  it('should reject Drug License (DL) labels & numbers', () => {
    expect(isValidDistributorName('DL')).toBe(false);
    expect(isValidDistributorName('DL NO')).toBe(false);
    expect(isValidDistributorName('DL-12345')).toBe(false);
    expect(isValidDistributorName('DL NO 12345/2023')).toBe(false);
    expect(isValidDistributorName('DRUG LIC NO 20B')).toBe(false);
    expect(sanitizeDistributorName('DL')).toBe('');
  });

  it('should reject pure phone numbers', () => {
    expect(isValidDistributorName('+919876543210')).toBe(false);
    expect(isValidDistributorName('9876543210')).toBe(false);
    expect(sanitizeDistributorName('+919876543210')).toBe('');
  });

  it('should reject GSTIN tax numbers', () => {
    expect(isValidDistributorName('27AAAAA0000A1Z5')).toBe(false);
    expect(sanitizeDistributorName('27AAAAA0000A1Z5')).toBe('');
  });

  it('should accept valid distributor & agency names', () => {
    expect(isValidDistributorName('Aaru Pharma')).toBe(true);
    expect(isValidDistributorName('Prime Distributors')).toBe(true);
    expect(isValidDistributorName('SENIOR AGENCY')).toBe(true);
    expect(isValidDistributorName('C.T.DISTRIBUTORS')).toBe(true);
    expect(sanitizeDistributorName('Aaru Pharma')).toBe('Aaru Pharma');
  });
});
