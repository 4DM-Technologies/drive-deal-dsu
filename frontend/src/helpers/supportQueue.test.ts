import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TICKET_FILTERS, DEFAULT_VERIFICATION_FILTERS, SUPPORT_CARD_LINKS, isToday, matchesTicketFilters, matchesVerificationFilters,
  supportStats, ticketFiltersFromSearch, verificationFiltersFromSearch,
} from '@/helpers/supportQueue';
import type { Ticket, Verification } from '@/types/domain';

const NOW = new Date(2026, 9, 12, 15, 30); // 12 Oct 2026, 3:30 pm local
const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();

const ticket = (over: Partial<Ticket>): Ticket => ({ id: 't', publicId: 'T-1', callerName: 'Caller', category: 'customer', summary: 's', status: 'open', priority: 'medium', createdAt: at(1, 9), updatedAt: at(1, 9), ...over });
const verification = (over: Partial<Verification>): Verification => ({ id: 'v', ticketId: 'V-1', category: 'dealer', profileName: 'P', businessName: null, state: 'TX', status: 'pending', submittedAt: at(1, 9), ...over });

describe('supportStats', () => {
  const tickets = [
    ticket({ id: '1', status: 'open', priority: 'urgent' }),
    ticket({ id: '2', status: 'in_progress', priority: 'high' }),
    ticket({ id: '3', status: 'on_hold', priority: 'low' }),
    ticket({ id: '4', status: 'resolved', priority: 'urgent', updatedAt: at(12, 9) }),
    ticket({ id: '5', status: 'resolved', priority: 'high', updatedAt: at(11, 23) }),
    ticket({ id: '6', status: 'closed', priority: 'urgent', updatedAt: at(12, 10) }),
  ];
  const verifications = [
    verification({ id: 'a', category: 'dealer', status: 'pending' }),
    verification({ id: 'b', category: 'dealer', status: 'pending' }),
    verification({ id: 'c', category: 'dealer', status: 'approved' }),
    verification({ id: 'd', category: 'agent', status: 'pending' }),
  ];
  const stats = supportStats(tickets, verifications, NOW);

  it('counts open tickets, leaving out resolved and closed ones', () => expect(stats.openTickets).toBe(3));
  it('counts high priority only among open tickets', () => expect(stats.highPriorityOpen).toBe(2));
  it('counts SLA risk as open urgent tickets, not resolved or closed ones', () => expect(stats.slaRisk).toBe(1));
  it('counts only pending dealer verifications, and reports team requests separately', () => {
    expect(stats.pendingDealerVerifications).toBe(2);
    expect(stats.pendingTeamRequests).toBe(1);
  });
  it('counts resolved tickets updated today, not earlier ones or closed ones', () => expect(stats.resolvedToday).toBe(1));
  it('is all zeros for an empty queue', () => {
    expect(supportStats([], [], NOW)).toEqual({ openTickets: 0, highPriorityOpen: 0, pendingDealerVerifications: 0, pendingTeamRequests: 0, slaRisk: 0, resolvedToday: 0 });
  });

  it('matches the rows the card links open', () => {
    const rows = (link: string) => tickets.filter((item) => matchesTicketFilters(item, ticketFiltersFromSearch(new URL(link, 'http://x').searchParams), NOW)).length;
    expect(rows(SUPPORT_CARD_LINKS.openTickets)).toBe(stats.openTickets);
    expect(rows(SUPPORT_CARD_LINKS.slaRisk)).toBe(stats.slaRisk);
    expect(rows(SUPPORT_CARD_LINKS.resolvedToday)).toBe(stats.resolvedToday);
    const filters = verificationFiltersFromSearch(new URL(SUPPORT_CARD_LINKS.pendingDealerVerifications, 'http://x').searchParams);
    expect(verifications.filter((item) => matchesVerificationFilters(item, filters)).length).toBe(stats.pendingDealerVerifications);
  });
});

describe('isToday', () => {
  it('is true from midnight to the end of the local day only', () => {
    expect(isToday(new Date(2026, 9, 12, 0, 0).toISOString(), NOW)).toBe(true);
    expect(isToday(new Date(2026, 9, 12, 23, 59).toISOString(), NOW)).toBe(true);
    expect(isToday(new Date(2026, 9, 11, 23, 59).toISOString(), NOW)).toBe(false);
    expect(isToday(new Date(2026, 9, 13, 0, 0).toISOString(), NOW)).toBe(false);
  });
});

describe('filters from the address bar', () => {
  it('falls back to the defaults when nothing is given', () => {
    expect(ticketFiltersFromSearch(new URLSearchParams(''))).toEqual(DEFAULT_TICKET_FILTERS);
    expect(verificationFiltersFromSearch(new URLSearchParams(''))).toEqual(DEFAULT_VERIFICATION_FILTERS);
  });
  it('reads every ticket filter', () => {
    expect(ticketFiltersFromSearch(new URLSearchParams('status=resolved&priority=urgent&applicant=dealer&period=today')))
      .toEqual({ status: 'resolved', priority: 'urgent', audience: 'dealer', period: 'today' });
  });
  it('ignores values the filters do not offer', () => {
    expect(ticketFiltersFromSearch(new URLSearchParams('status=bogus&priority=<script>&applicant=agent&period=yesterday'))).toEqual(DEFAULT_TICKET_FILTERS);
    expect(verificationFiltersFromSearch(new URLSearchParams('status=nope&applicant=customer'))).toEqual(DEFAULT_VERIFICATION_FILTERS);
  });
});
