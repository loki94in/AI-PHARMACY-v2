import { sanitizeDoctorName } from '../src/utils/doctorUtils.js';

describe('Doctor Name Sanitization & Deduplication Tests', () => {
  it('should strip leading Dr. prefix with dot and space', () => {
    expect(sanitizeDoctorName('Dr. Rajiv Sharma')).toBe('Rajiv Sharma');
  });

  it('should strip leading Dr prefix without dot', () => {
    expect(sanitizeDoctorName('Dr John Doe')).toBe('John Doe');
  });

  it('should strip leading DR. uppercase prefix', () => {
    expect(sanitizeDoctorName('DR. SANJAY GUPTA')).toBe('SANJAY GUPTA');
  });

  it('should strip leading Doctor prefix', () => {
    expect(sanitizeDoctorName('Doctor House')).toBe('House');
  });

  it('should strip Dr. with dot and no space', () => {
    expect(sanitizeDoctorName('Dr.Smith')).toBe('Smith');
  });

  it('should leave clean names unchanged', () => {
    expect(sanitizeDoctorName('Amit Verma')).toBe('Amit Verma');
  });

  it('should return empty string for null or undefined', () => {
    expect(sanitizeDoctorName(null)).toBe('');
    expect(sanitizeDoctorName(undefined)).toBe('');
  });
});
