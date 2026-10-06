import { Check, ShieldCheck } from 'lucide-react';
import type { CustomerDetails } from '@/helpers/checkout';
import { formatMoney } from '@/helpers/currency';
import { planCatalog, premiumName } from '@/helpers/plans';
import { premiumTerm } from '@/helpers/subscription';
import type { Subscription } from '@/types/domain';

interface OrderSummaryProps {
  subscription: Subscription;
  /** Shown once the first step is done, with a way back to change it. */
  billedTo?: CustomerDetails | undefined;
  onEditDetails?: () => void;
  /** Drops the list of what Premium includes, so the summary stays short beside the card form. */
  compact?: boolean;
}

/** What is being bought and what it costs. Stays beside the form on the first two steps. */
export function OrderSummary({ subscription, billedTo, onEditDetails, compact = false }: OrderSummaryProps) {
  const price = formatMoney(subscription.premiumPrice, true);
  const includes = planCatalog(subscription.role, subscription.premiumPrice).premium.features.slice(0, 2);
  return (
    <section className="card checkout-summary" aria-labelledby="checkout-summary-title">
      <h2 id="checkout-summary-title">Order summary</h2>
      <div className="summary-plan">
        <div><strong>{premiumName(subscription.role)}</strong><small>1 year</small></div>
        <span className="summary-plan-price">{price}</span>
      </div>
      {!compact && <ul className="summary-includes">{includes.map((item) => <li key={item}><Check size={15} aria-hidden="true" />{item}</li>)}</ul>}
      <dl className="pay-summary">
        <div className="pay-muted"><dt>Term</dt><dd>{premiumTerm(subscription)}</dd></div>
        <div className="pay-total"><dt>Total amount</dt><dd>{price} <small>{subscription.currency}</small></dd></div>
      </dl>
      {billedTo && (
        <div className="summary-billed">
          <div><small>Billed to</small><strong>{billedTo.fullName.trim()}</strong><span>{billedTo.email.trim()}</span></div>
          {onEditDetails && <button type="button" className="summary-edit" onClick={onEditDetails}>Edit</button>}
        </div>
      )}
      <p className="summary-note"><ShieldCheck size={15} aria-hidden="true" />One payment for the year. No automatic renewal.</p>
    </section>
  );
}
