import { ArrowRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PlanOffer } from '@/helpers/plans';

interface PlanOfferCardProps {
  offer: PlanOffer;
  featured?: boolean;
  /** Small pill beside the plan name, e.g. "Recommended". */
  badge?: string;
  /** The button or link under the price. */
  action: ReactNode;
  /** One quiet line under the button. */
  note?: string;
}

/** One plan in the comparison: name, price, a single action, and what it includes. */
export function PlanOfferCard({ offer, featured = false, badge, action, note }: PlanOfferCardProps) {
  const titleId = `plan-${offer.id}-title`;
  return (
    <article className={`card plan-card ${featured ? 'plan-card-featured' : ''}`} aria-labelledby={titleId}>
      <header className="plan-card-head">
        <div className="plan-card-name"><h2 id={titleId}>{offer.name}</h2>{badge && <span className="plan-badge">{badge}</span>}</div>
        <p>{offer.tagline}</p>
      </header>
      <div className="plan-card-price"><strong>{offer.price}</strong><span>{offer.period}</span></div>
      <div className="plan-card-action">{action}{note && <small>{note}</small>}</div>
      <div className="plan-card-includes">
        <h3>{offer.lead}</h3>
        <ul>{offer.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
      </div>
    </article>
  );
}

/** The upgrade or renew link used on the Premium card. */
export function UpgradeLink({ label, secondary = false }: { label: string; secondary?: boolean }) {
  return <Link className={`button button-wide ${secondary ? 'button-secondary' : 'button-primary'}`} to="/billing">{label}<ArrowRight size={16} /></Link>;
}
