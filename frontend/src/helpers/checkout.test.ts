import { describe, expect, it } from 'vitest';

import { checkoutSteps, validateDetails } from '@/helpers/checkout';
import type { CustomerDetails } from '@/helpers/checkout';

const valid: CustomerDetails = { fullName: 'Rahul Sharma', email: 'rahul@example.com', phone: '(469) 555-0142', company: '', address: '12 Main Street, Frisco, TX' };

describe('validateDetails', () => {
  it('accepts complete details, with phone and company optional', () => {
    expect(validateDetails(valid)).toEqual({});
    expect(validateDetails({ ...valid, phone: '', company: '' })).toEqual({});
  });

  it('requires a name, an email and an address', () => {
    expect(validateDetails({ ...valid, fullName: ' ', email: '', address: '' })).toEqual({
      fullName: 'Enter your full name.', email: 'Enter your email address.', address: 'Enter your billing address.',
    });
  });

  it('rejects a malformed email and a too-short phone', () => {
    expect(validateDetails({ ...valid, email: 'rahul@' }).email).toMatch(/valid email/);
    expect(validateDetails({ ...valid, email: 'rahul example.com' }).email).toMatch(/valid email/);
    expect(validateDetails({ ...valid, phone: '12-34' }).phone).toMatch(/at least 7 digits/);
  });
});

describe('checkoutSteps', () => {
  it('runs customer details, payment method, then confirmation', () => {
    expect(checkoutSteps.map((step) => step.id)).toEqual(['details', 'payment', 'confirmation']);
  });
});
