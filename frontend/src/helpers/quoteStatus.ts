import type { Quote } from '@/types/domain';

/** A dealer's quote is still in play while the buyer has it under consideration or is negotiating it. */
export const ACTIVE_QUOTE_STATUSES: readonly Quote['status'][] = ['pending', 'negotiating'];
