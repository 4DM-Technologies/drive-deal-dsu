import { describe, expect, it } from 'vitest';
import { buyerQuickReplies, withQuickReply } from '@/helpers/chatQuickReplies';
import { violatesChatGuidelines } from '@/helpers/communityGuidelines';

describe('buyerQuickReplies', () => {
  it('words the replies for the vehicle and the offer', () => {
    const replies = buyerQuickReplies('BMW 5 Series', '34230.04');
    expect(replies.map((reply) => reply.label)).toEqual(['Book a visit', 'Negotiate price', 'Schedule a test drive', 'Is it still available?', 'Financing options', 'Trade-in value']);
    expect(replies.find((reply) => reply.id === 'visit')?.message).toContain('BMW 5 Series');
    expect(replies.find((reply) => reply.id === 'negotiate')?.message).toContain('$34,230');
  });

  it('still reads well without a price', () => {
    expect(buyerQuickReplies('Audi Q3', null).find((reply) => reply.id === 'negotiate')?.message).toBe('Is there any flexibility on the out-the-door price? I’m ready to move forward if we can agree on a better number.');
  });

  it('passes the chat community guidelines, so a chosen reply can always be sent', () => {
    for (const reply of buyerQuickReplies('Honda Jazz', '25000')) expect(violatesChatGuidelines(reply.message)).toBe(false);
  });
});

describe('withQuickReply', () => {
  it('fills an empty composer and adds to text already typed', () => {
    expect(withQuickReply('', 'Hello')).toBe('Hello');
    expect(withQuickReply('Thanks for the offer.  ', 'Hello')).toBe('Thanks for the offer.\nHello');
  });
});
