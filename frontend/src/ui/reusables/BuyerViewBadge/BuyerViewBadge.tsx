import { Eye, EyeOff } from 'lucide-react';

/** Whether the buyer has opened a quote, for the dealer's Quotes table. */
export function BuyerViewBadge({ viewed }: { viewed: boolean }) {
  return viewed
    ? <span className="status status-viewed" title="The buyer has opened this quote."><Eye size={13} /> Viewed</span>
    : <span className="status status-unviewed" title="The buyer has not opened this quote yet."><EyeOff size={13} /> Not viewed yet</span>;
}
