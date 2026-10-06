import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { brandLabels } from '@/helpers/card';
import type { CardBrand } from '@/helpers/card';
import { formatMoney } from '@/helpers/currency';
import { formatLongDate } from '@/helpers/dateTime';
import type { PaymentReceipt } from '@/types/domain';

const asBrand = (value: string | null): CardBrand => (value === 'visa' || value === 'mastercard' || value === 'amex' || value === 'discover' ? value : 'unknown');

/** Shown in place of the card form once a payment succeeds. */
export function ReceiptView({ receipt, onDashboard, onStay }: { receipt: PaymentReceipt; onDashboard: () => void; onStay: () => void }) {
  const brand = brandLabels[asBrand(receipt.cardBrand)];
  const method = receipt.paymentMethod === 'credit_card' ? 'credit' : 'debit';
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return (
    <section className="card receipt" role="status" aria-labelledby="receipt-title">
      <span className="receipt-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 12.6l4.1 4.1L18.2 8.2" /></svg>
      </span>
      <span className="eyebrow">Payment successful</span>
      <h2 id="receipt-title" ref={heading} tabIndex={-1}>You’re on Premium</h2>
      <p className="receipt-until">Active until <strong>{formatLongDate(receipt.premiumExpiresAt)}</strong></p>
      <dl className="receipt-lines">
        <div><dt>Amount paid</dt><dd>{formatMoney(receipt.amount, true)} <small>{receipt.currency}</small></dd></div>
        <div><dt>Paid with</dt><dd>{brand} {method}{receipt.cardLast4 ? ` ·· ${receipt.cardLast4}` : ''}</dd></div>
        <div><dt>Plan</dt><dd>{receipt.plan === 'dealer_premium' ? 'Dealer Premium · 1 year' : 'Buyer Premium · 1 year'}</dd></div>
        <div><dt>Reference</dt><dd className="receipt-ref">{receipt.paymentId.slice(0, 8).toUpperCase()}</dd></div>
      </dl>
      <div className="receipt-actions">
        <button type="button" className="button button-primary" onClick={onDashboard}>Go to dashboard <ArrowRight size={16} /></button>
        <button type="button" className="button button-ghost" onClick={onStay}>Stay on billing</button>
      </div>
    </section>
  );
}
