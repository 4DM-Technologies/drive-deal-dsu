import type { DealStatus, QuoteStatus, RequestStatus, VerificationStatus } from '@/types/domain';

type Status = DealStatus | QuoteStatus | RequestStatus | VerificationStatus | 'live' | 'in_progress' | 'on_hold' | 'resolved' | 'closed' | 'open' | 'quoted';

const labels: Partial<Record<Status, string>> = {
  live: 'Live', quoted: 'Quoted', open: 'New', in_progress: 'In progress', on_hold: 'On hold', resolved: 'Resolved',
  paperwork_going_on: 'Paperwork', funds_arrived: 'Funds arrived', dispatch: 'Dispatch',
  delivery: 'Delivery', completed: 'Completed', cancelled: 'Cancelled',
};

export function StatusBadge({ status }: { status: Status }) {
  const label = labels[status] ?? status.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  return <span className={`status status-${status}`}>{label}</span>;
}
