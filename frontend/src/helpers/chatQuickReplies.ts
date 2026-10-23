import { formatMoney } from '@/helpers/currency';

export type QuickReplyId = 'visit' | 'negotiate' | 'test-drive' | 'availability' | 'financing' | 'trade-in';

export interface QuickReply { id: QuickReplyId; label: string; message: string }

/**
 * Ready-written messages a buyer can start from in a conversation with a dealer, worded for this vehicle and offer.
 * They fill the composer to edit and send; nothing is sent on a click.
 */
export function buyerQuickReplies(vehicle: string, finalPrice: string | number | null | undefined): QuickReply[] {
  const price = finalPrice == null || finalPrice === '' ? null : formatMoney(finalPrice);
  return [
    { id: 'visit', label: 'Book a visit', message: `Hi, I’d like to book a visit to see the ${vehicle} in person. Which days and times work for you this week?` },
    { id: 'negotiate', label: 'Negotiate price', message: price ? `Is there any flexibility on the ${price} out-the-door price? I’m ready to move forward if we can agree on a better number.` : 'Is there any flexibility on the out-the-door price? I’m ready to move forward if we can agree on a better number.' },
    { id: 'test-drive', label: 'Schedule a test drive', message: `Could I schedule a test drive of the ${vehicle}? Please let me know which times are available.` },
    { id: 'availability', label: 'Is it still available?', message: `Is the ${vehicle} still available, and how soon could it be ready for delivery?` },
    { id: 'financing', label: 'Financing options', message: 'What financing options do you offer for this vehicle, and what rates are currently available?' },
    { id: 'trade-in', label: 'Trade-in value', message: 'Would you consider a trade-in? I can share the details of my current car for a valuation.' },
  ];
}

/** The composer text after choosing a quick reply: the reply alone, or added on a new line after what's already typed. */
export function withQuickReply(current: string, message: string): string {
  const typed = current.trimEnd();
  return typed ? `${typed}\n${message}` : message;
}
