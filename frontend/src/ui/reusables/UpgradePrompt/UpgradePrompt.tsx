import { ArrowRight, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { smoothScroll } from '@/helpers/motion';
import { gateCopy } from '@/helpers/subscription';
import type { SubscriptionReason } from '@/services/platform/apiError';
import type { Subscription } from '@/types/domain';

interface UpgradePromptProps {
  reason: SubscriptionReason | null;
  role: Subscription['role'];
  limit?: number | null;
  /** Adds the yearly price to the button when known. */
  subscription?: Subscription | null;
  /** Keeps the preview mode (read-only workspace views) when linking to billing. */
  search?: string;
  /** Scrolls the prompt into view when it appears, for refusals that happen at the bottom of a long form. */
  reveal?: boolean;
}

/** Shown in place of a create action the plan no longer allows, or after the server refuses it with a 402. */
export function UpgradePrompt({ reason, role, limit = null, subscription = null, search = '', reveal = false }: UpgradePromptProps) {
  const { title, body } = gateCopy(reason, role, limit);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reveal) ref.current?.scrollIntoView({ behavior: smoothScroll(), block: 'center' }); }, [reveal]);
  return (
    <div className="upgrade-prompt" role={reveal ? 'alert' : 'status'} ref={ref}>
      <span className="upgrade-prompt-icon"><Lock size={18} /></span>
      <div><strong>{title}</strong><p>{body}</p></div>
      <Link className="button button-primary upgrade-prompt-cta" to={`/billing${search}`}>
        {reason === 'premium_expired' ? 'Renew Premium' : 'Upgrade to Premium'}{subscription ? <small>{formatMoney(subscription.premiumPrice)} / year</small> : null}
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
