import { describe, expect, it } from 'vitest';
import { DRIVING_LICENSE_ACCEPT, drivingLicenseProblem, formatFileSize } from '@/helpers/drivingLicense';

const file = (name: string, type: string, size = 2048) => ({ name, type, size });

describe('drivingLicenseProblem', () => {
  it('accepts a PDF', () => {
    expect(drivingLicenseProblem(file('scan.pdf', 'application/pdf'))).toBeNull();
  });

  it('falls back to the extension when the browser reports no type', () => {
    expect(drivingLicenseProblem(file('LICENCE.PDF', ''))).toBeNull();
    expect(drivingLicenseProblem(file('notes.txt', ''))).toMatch(/PDF/);
  });

  it('rejects photos and other formats', () => {
    expect(drivingLicenseProblem(file('licence.jpg', 'image/jpeg'))).toMatch(/PDF/);
    expect(drivingLicenseProblem(file('licence.png', 'image/png'))).toMatch(/PDF/);
    expect(drivingLicenseProblem(file('licence.webp', 'image/webp'))).toMatch(/PDF/);
    expect(drivingLicenseProblem(file('licence.jpg', ''))).toMatch(/PDF/);
  });

  it('trusts the reported type over the file name', () => {
    expect(drivingLicenseProblem(file('licence.pdf', 'image/png'))).toMatch(/PDF/);
  });

  it('rejects empty and oversized files', () => {
    expect(drivingLicenseProblem(file('licence.pdf', 'application/pdf', 0))).toMatch(/empty/);
    expect(drivingLicenseProblem(file('licence.pdf', 'application/pdf', 10 * 1024 * 1024))).toBeNull();
    expect(drivingLicenseProblem(file('licence.pdf', 'application/pdf', 10 * 1024 * 1024 + 1))).toMatch(/over 10 MB/);
  });
});

describe('formatFileSize', () => {
  it('uses KB below a megabyte and MB above', () => {
    expect(formatFileSize(10)).toBe('1 KB');
    expect(formatFileSize(512 * 1024)).toBe('512 KB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

describe('DRIVING_LICENSE_ACCEPT', () => {
  it('limits the file picker to PDFs, by MIME type and extension', () => {
    expect(DRIVING_LICENSE_ACCEPT).toBe('application/pdf,.pdf');
  });
});
