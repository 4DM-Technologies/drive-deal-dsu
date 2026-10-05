export function formatMoney(value: string | number, cents = false): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

export function computeOtd(values: {
  vehiclePrice: string;
  docFee: string;
  salesTax: string;
  titleReg: string;
  tradeInCredit: string;
}): string {
  const cents = (value: string) => Math.round(Number(value || 0) * 100);
  return ((cents(values.vehiclePrice) + cents(values.docFee) + cents(values.salesTax) + cents(values.titleReg) - cents(values.tradeInCredit)) / 100).toFixed(2);
}
