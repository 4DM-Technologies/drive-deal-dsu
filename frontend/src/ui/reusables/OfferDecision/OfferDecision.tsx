import { Check, Clock3, Info, MessageCircle, Package, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { client } from '@/services/platform/client';
import { ConfirmDialog } from '@/ui/reusables/ConfirmDialog/ConfirmDialog';
import type { Quote } from '@/types/domain';

const closedNotes: Partial<Record<Quote['status'], string>> = {
  declined: 'You declined this offer.',
  withdrawn: 'The dealer withdrew this offer.',
  expired: 'This offer has expired.',
};

interface OfferDecisionProps {
  quote: Quote;
  /** "BMW 5 Series", used in the negotiation note. */
  vehicle: string;
  /** Called after an accept, decline or negotiation request goes through, with a message to show the buyer. */
  onChanged: (message: string) => void;
}

/**
 * The buyer's decision on one offer: accept, ask to negotiate, or decline, each with its confirmation step.
 * Only actions that make sense for the offer's status are shown, so a closed offer cannot be accepted again.
 */
export function OfferDecision({ quote, vehicle, onChanged }: OfferDecisionProps) {
  const [confirming, setConfirming] = useState<'accept' | 'decline' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [negotiating, setNegotiating] = useState(false);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const open = quote.status === 'pending' || quote.status === 'negotiating';

  async function confirm() {
    if (!confirming) return;
    setBusy(true);
    setError('');
    try {
      if (confirming === 'accept') {
        await client.quotes.accept(quote.id);
        onChanged(`You accepted ${quote.dealerName}’s offer. The order and dealer conversation are now open.`);
      } else {
        await client.quotes.decline(quote.id);
        onChanged(`You declined ${quote.dealerName}’s offer.`);
      }
      setConfirming(null);
    } catch {
      setError('That did not go through. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendNegotiation() {
    if (!note.trim()) return;
    setBusy(true);
    setNoteError('');
    try {
      await client.chats.requestAccess(quote.id, note.trim());
      setNegotiating(false);
      onChanged(`Negotiation request sent to ${quote.dealerName}. They can read your note before contact opens.`);
    } catch {
      setNoteError('Your request could not be sent. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const negotiation = quote.contactAvailable
    ? <Link className="button button-secondary" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Message dealer</Link>
    : quote.chatRequestStatus === 'pending'
      ? <Link className="button button-secondary" to={`/chat/${quote.id}`}><Clock3 size={17} /> Request pending</Link>
      : <button type="button" className="button button-secondary" onClick={() => { setNoteError(''); setNote(`I like your ${vehicle} offer. I would like to discuss the equipment and final price before deciding.`); setNegotiating(true); }}><MessageCircle size={17} /> Ask to negotiate</button>;

  return <>
    {quote.status === 'accepted' ? <div className="grid offer-decision">
      <span className="offer-decision-done"><Check size={17} /> You accepted this offer</span>
      <Link className="button button-primary" to={`/orders/${quote.id}`}><Package size={17} /> View order</Link>
      <Link className="button button-secondary" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Message dealer</Link>
    </div> : open ? <div className="grid offer-decision">
      <button type="button" className="button button-primary" onClick={() => { setError(''); setConfirming('accept'); }}><Check size={17} /> Accept offer</button>
      {negotiation}
      <button type="button" className="button button-ghost" onClick={() => { setError(''); setConfirming('decline'); }}><X size={17} /> Decline offer</button>
    </div> : <p className="offer-decision-closed"><Info size={16} /> {closedNotes[quote.status] ?? 'This offer is no longer open.'}</p>}

    {confirming && <ConfirmDialog open title={confirming === 'accept' ? 'Accept this offer?' : 'Decline this offer?'} description={confirming === 'accept' ? 'Accepting opens a private conversation with this dealer. Your other offers on this request will be declined.' : 'The dealer will be told this offer was declined. You can keep comparing your other offers.'} details={<><span>{quote.dealerName}</span><strong className="price">{formatMoney(quote.finalPrice)}</strong><small>Out-the-door total</small></>} confirmLabel={confirming === 'accept' ? 'Yes, accept offer' : 'Yes, decline offer'} tone={confirming === 'accept' ? 'primary' : 'danger'} busy={busy} error={error} onConfirm={() => void confirm()} onCancel={() => setConfirming(null)} />}

    {negotiating && <div className="modal-backdrop" role="presentation" onMouseDown={() => setNegotiating(false)}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby={`negotiation-title-${quote.id}`} onMouseDown={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={() => setNegotiating(false)} aria-label="Close"><X /></button>
      <span className="eyebrow">Private negotiation request</span>
      <h2 id={`negotiation-title-${quote.id}`}>Ask {quote.dealerName} to chat</h2>
      <p className="muted">This note is visible before your identity is shared. If the dealer accepts, it becomes the first message in the conversation.</p>
      <div className="field"><label htmlFor={`negotiation-note-${quote.id}`}>Your opening note</label><textarea id={`negotiation-note-${quote.id}`} className="textarea" rows={5} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></div>
      <small className="character-count">{note.length}/1000</small>
      {noteError && <div className="inline-warning" role="alert">{noteError}</div>}
      <button className="button button-primary button-wide" onClick={() => void sendNegotiation()} disabled={!note.trim() || busy}><MessageCircle size={17} /> {busy ? 'Sending…' : 'Send negotiation request'}</button>
    </section></div>}
  </>;
}
