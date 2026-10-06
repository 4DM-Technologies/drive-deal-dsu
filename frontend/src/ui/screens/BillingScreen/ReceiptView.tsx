import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { brandLabels } from '@/helpers/card';
import type { CardBrand } from '@/helpers/card';
import type { CustomerDetails } from '@/helpers/checkout';
import { formatMoney } from '@/helpers/currency';
import { formatLongDate } from '@/helpers/dateTime';
import type { PaymentReceipt } from '@/types/domain';

const asBrand = (value: string | null): CardBrand => (value === 'visa' || value === 'mastercard' || value === 'amex' || value === 'discover' ? value : 'unknown');

interface ReceiptViewProps {
  receipt: PaymentReceipt;
  billedTo: CustomerDetails;
}

/** Step 3: the payment went through. */
export function ReceiptView({ receipt, billedTo }: ReceiptViewProps) {
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
        <div><dt>Plan</dt><dd>{receipt.plan === 'dealer_premium' ? 'Premium dealer, 1 year' : 'Premium, 1 year'}</dd></div>
        <div><dt>Billed to</dt><dd>{billedTo.fullName.trim()}<small className="receipt-sub">{billedTo.email.trim()}</small></dd></div>
        <div><dt>Reference</dt><dd className="receipt-ref">{receipt.paymentId.slice(0, 8).toUpperCase()}</dd></div>
      </dl>
      <div className="receipt-actions">
        <Link className="button button-primary" to="/home">Go to dashboard <ArrowRight size={16} /></Link>
        <Link className="button button-secondary" to="/account">View my account</Link>
      </div>
    </section>
  );
}
