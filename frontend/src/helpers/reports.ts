import type { ReportOutcome, ReportReason, ReportStatus, Role } from '@/types/domain';

export interface ReasonOption { value: ReportReason; label: string; description: string }

const SHARED_FIRST: ReasonOption[] = [
  { value: 'scam_fraud', label: 'Scam or fraud', description: 'Fake identity, stolen details, or a deal that is not real' },
  { value: 'off_platform_payment', label: 'Asked for payment outside Deal&Drive', description: 'Wire transfers, gift cards, or deposits to a personal account' },
];
const SHARED_LAST: ReasonOption[] = [
  { value: 'harassment', label: 'Harassment or abusive language', description: 'Threats, insults, or discriminatory remarks' },
  { value: 'spam', label: 'Spam or unrelated messages', description: 'Advertising, links, or messages unrelated to this deal' },
  { value: 'other', label: 'Something else', description: 'Another kind of misconduct' },
];

// Mirrors the API's lists: each side can only be reported for what that side can do.
const DEALER_REASONS: ReasonOption[] = [
  ...SHARED_FIRST,
  { value: 'misleading_listing', label: 'Misleading vehicle, price or fees', description: 'Details or charges that differ from the quote' },
  { value: 'pressure_tactics', label: 'Pressure or bait-and-switch', description: 'Rushing a decision or swapping the vehicle or price' },
  ...SHARED_LAST,
];
const BUYER_REASONS: ReasonOption[] = [
  ...SHARED_FIRST,
  { value: 'fake_buyer', label: 'Fake or non-serious buyer', description: 'Not genuinely buying, or using a false identity' },
  { value: 'no_show', label: 'No-show or backed out', description: 'Missed agreed appointments or walked away from an agreed deal' },
  ...SHARED_LAST,
];

/** The reasons that apply to the person being reported. */
export const reportReasons = (reportedRole: Role): ReasonOption[] => (reportedRole === 'dealer' ? DEALER_REASONS : BUYER_REASONS);

const REASON_LABELS = Object.fromEntries([...DEALER_REASONS, ...BUYER_REASONS].map((option) => [option.value, option.label])) as Record<ReportReason, string>;
export const reportReasonLabel = (reason: ReportReason): string => REASON_LABELS[reason];

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = { open: 'New', under_review: 'Under review', action_taken: 'Action taken', dismissed: 'Dismissed' };
export const REPORT_OUTCOME_LABELS: Record<ReportOutcome, string> = { no_violation: 'No violation', warning_issued: 'Warning issued', account_suspended: 'Account suspended', other: 'Other action' };
export const isClosedReport = (status: ReportStatus): boolean => status === 'action_taken' || status === 'dismissed';

// Mirrors the API's rules (the server re-checks each file's real type), so a bad file is caught before sending.
export const REPORT_MAX_FILES = 3;
export const REPORT_MAX_BYTES = 5 * 1024 * 1024;
export const REPORT_DETAILS_MIN = 20;
export const REPORT_DETAILS_MAX = 2000;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const REPORT_ACCEPT = [...IMAGE_TYPES, '.jpg', '.jpeg', '.png', '.webp'].join(',');

/** Why these screenshots can't be added to the ones already picked, or '' when they can. */
export function reportFilesProblem(current: File[], picked: File[]): string {
  if (picked.some((file) => !IMAGE_TYPES.includes(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name))) return 'Attach screenshots only (JPG, PNG or WebP).';
  if (picked.some((file) => file.size > REPORT_MAX_BYTES)) return 'Each screenshot must be 5 MB or smaller.';
  if (current.length + picked.length > REPORT_MAX_FILES) return `You can attach up to ${REPORT_MAX_FILES} screenshots.`;
  return '';
}
