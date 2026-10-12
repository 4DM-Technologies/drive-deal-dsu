import type { Ticket, Verification } from '@/types/domain';

/**
 * What the support console counts and where each count links to. The cards and the lists they open share these
 * predicates, so the number on a card is always the number of rows on the page it leads to.
 */

export type TicketStatusFilter = 'active' | 'all' | Ticket['status'];
export type TicketPriorityFilter = 'all' | Ticket['priority'];
export type TicketAudienceFilter = 'all' | Ticket['category'];
export type VerificationStatusFilter = 'all' | Verification['status'];
export type VerificationApplicantFilter = 'all' | 'dealer' | 'agent';

export interface TicketFilters {
  status: TicketStatusFilter;
  priority: TicketPriorityFilter;
  audience: TicketAudienceFilter;
  /** `today` keeps only tickets last updated since local midnight. */
  period: 'any' | 'today';
}

export interface VerificationFilters {
  status: VerificationStatusFilter;
  applicant: VerificationApplicantFilter;
}

export const DEFAULT_TICKET_FILTERS: TicketFilters = { status: 'active', priority: 'all', audience: 'all', period: 'any' };
export const DEFAULT_VERIFICATION_FILTERS: VerificationFilters = { status: 'all', applicant: 'all' };
/** The console's approval panel is about dealers waiting for a decision. */
export const PENDING_DEALER_FILTERS: VerificationFilters = { status: 'pending', applicant: 'dealer' };

const TICKET_STATUSES: readonly string[] = ['active', 'all', 'open', 'in_progress', 'on_hold', 'resolved', 'closed'];
const TICKET_PRIORITIES: readonly string[] = ['all', 'urgent', 'high', 'medium', 'low'];
const TICKET_AUDIENCES: readonly string[] = ['all', 'customer', 'dealer'];
const VERIFICATION_STATUSES: readonly string[] = ['all', 'pending', 'approved', 'denied', 'rejected'];
const VERIFICATION_APPLICANTS: readonly string[] = ['all', 'dealer', 'agent'];

/** A value from the address bar only counts when it is one the filter offers; anything else falls back to the default. */
const pick = <T extends string>(value: string | null, allowed: readonly string[], fallback: T): T => (value !== null && allowed.includes(value) ? value as T : fallback);

export function ticketFiltersFromSearch(params: URLSearchParams): TicketFilters {
  return {
    status: pick(params.get('status'), TICKET_STATUSES, DEFAULT_TICKET_FILTERS.status),
    priority: pick(params.get('priority'), TICKET_PRIORITIES, DEFAULT_TICKET_FILTERS.priority),
    audience: pick(params.get('applicant'), TICKET_AUDIENCES, DEFAULT_TICKET_FILTERS.audience),
    period: params.get('period') === 'today' ? 'today' : 'any',
  };
}

export function verificationFiltersFromSearch(params: URLSearchParams): VerificationFilters {
  return {
    status: pick(params.get('status'), VERIFICATION_STATUSES, DEFAULT_VERIFICATION_FILTERS.status),
    applicant: pick(params.get('applicant'), VERIFICATION_APPLICANTS, DEFAULT_VERIFICATION_FILTERS.applicant),
  };
}

export const isActiveTicket = (ticket: Pick<Ticket, 'status'>) => !['resolved', 'closed'].includes(ticket.status);

/** Whether `iso` falls on the same local calendar day as `now`. */
export function isToday(iso: string, now: Date = new Date()): boolean {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export function matchesTicketFilters(ticket: Ticket, filters: TicketFilters, now: Date = new Date()): boolean {
  const statusMatches = filters.status === 'all' || (filters.status === 'active' ? isActiveTicket(ticket) : ticket.status === filters.status);
  return statusMatches
    && (filters.priority === 'all' || ticket.priority === filters.priority)
    && (filters.audience === 'all' || ticket.category === filters.audience)
    && (filters.period === 'any' || isToday(ticket.updatedAt, now));
}

export function matchesVerificationFilters(item: Verification, filters: VerificationFilters): boolean {
  return (filters.status === 'all' || item.status === filters.status)
    && (filters.applicant === 'all' || item.category === filters.applicant);
}

export interface SupportStats {
  openTickets: number;
  /** High or urgent tickets that are still open. */
  highPriorityOpen: number;
  pendingDealerVerifications: number;
  /** Support-team access requests waiting, which the dealer count leaves out. */
  pendingTeamRequests: number;
  /** Urgent tickets that are still open. */
  slaRisk: number;
  /** Tickets marked resolved that were last updated today. */
  resolvedToday: number;
}

export function supportStats(tickets: Ticket[], verifications: Verification[], now: Date = new Date()): SupportStats {
  const open = tickets.filter(isActiveTicket);
  const pending = verifications.filter((item) => item.status === 'pending');
  return {
    openTickets: open.length,
    highPriorityOpen: open.filter((ticket) => ticket.priority === 'high' || ticket.priority === 'urgent').length,
    pendingDealerVerifications: pending.filter((item) => item.category === 'dealer').length,
    pendingTeamRequests: pending.filter((item) => item.category === 'agent').length,
    slaRisk: open.filter((ticket) => ticket.priority === 'urgent').length,
    resolvedToday: tickets.filter((ticket) => matchesTicketFilters(ticket, { ...DEFAULT_TICKET_FILTERS, status: 'resolved', period: 'today' }, now)).length,
  };
}

/** Where each console card leads; every link opens a list filtered to exactly what the card counts. */
export const SUPPORT_CARD_LINKS = Object.freeze({
  openTickets: '/tickets?status=active',
  pendingDealerVerifications: '/verifications?status=pending&applicant=dealer',
  slaRisk: '/tickets?status=active&priority=urgent',
  resolvedToday: '/tickets?status=resolved&period=today',
});
