import { describe, expect, it } from 'vitest';
import { REPORT_MAX_BYTES, isClosedReport, reportFilesProblem, reportReasonLabel, reportReasons } from '@/helpers/reports';

const file = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type });

describe('reportReasons', () => {
  it('offers dealer-only reasons when reporting a dealer and buyer-only reasons when reporting a buyer', () => {
    const dealer = reportReasons('dealer').map((option) => option.value);
    const buyer = reportReasons('buyer').map((option) => option.value);
    expect(dealer).toContain('misleading_listing');
    expect(dealer).not.toContain('fake_buyer');
    expect(buyer).toContain('no_show');
    expect(buyer).not.toContain('pressure_tactics');
    expect(dealer.at(-1)).toBe('other');
    expect(buyer.at(-1)).toBe('other');
  });

  it('labels every reason', () => {
    expect(reportReasonLabel('off_platform_payment')).toBe('Asked for payment outside Deal&Drive');
    expect(reportReasonLabel('no_show')).toBe('No-show or backed out');
  });
});

describe('reportFilesProblem', () => {
  it('accepts up to three small images', () => {
    expect(reportFilesProblem([], [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.webp', 'image/webp')])).toBe('');
  });

  it('rejects PDFs, oversized images and a fourth screenshot', () => {
    expect(reportFilesProblem([], [file('a.pdf', 'application/pdf')])).toMatch(/screenshots only/);
    expect(reportFilesProblem([], [file('a.png', 'image/png', REPORT_MAX_BYTES + 1)])).toMatch(/5 MB/);
    expect(reportFilesProblem([file('a.png', 'image/png'), file('b.png', 'image/png'), file('c.png', 'image/png')], [file('d.png', 'image/png')])).toMatch(/up to 3/);
  });
});

it('treats action taken and dismissed as closed', () => {
  expect(isClosedReport('action_taken')).toBe(true);
  expect(isClosedReport('dismissed')).toBe(true);
  expect(isClosedReport('under_review')).toBe(false);
});
