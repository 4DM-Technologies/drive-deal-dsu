import { describe, expect, it } from 'vitest';

import { computeOtd, formatMoney } from '@/helpers/currency';

describe('currency helpers', () => {
  it('calculates out-the-door totals in integer cents', () => {
    expect(computeOtd({ vehiclePrice: '65345', docFee: '800', salesTax: '4084', titleReg: '210', tradeInCredit: '3500' })).toBe('66939.00');
  });

  it('formats customer-facing US currency', () => {
    expect(formatMoney('70229')).toBe('$70,229');
    expect(formatMoney('70229.5', true)).toBe('$70,229.50');
  });
});
