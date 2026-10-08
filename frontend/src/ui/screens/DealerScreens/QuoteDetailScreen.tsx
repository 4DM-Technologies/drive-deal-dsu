import { ArrowLeft, CheckCircle2, Download, FileCheck2, FileUp, History, Image, ImageOff, MessageCircle, Pencil, ShieldCheck, TrendingDown, Trophy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { computeOtd, formatMoney } from '@/helpers/currency';
import { formatLongDate } from '@/helpers/dateTime';
import { smoothScroll } from '@/helpers/motion';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import type { BuyerRequest, DealDocument, Quote } from '@/types/domain';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { StatusBadge } from '@/ui/reusables/StatusBadge/StatusBadge';

/** The same flat rate the new-quote form uses. */
const SALES_TAX_RATE = 0.0625;
const DOCUMENT_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const DOCUMENT_LIMIT_BYTES = 20 * 1024 * 1024;
const MONEY = /^\d+(\.\d{1,2})?$/;
const cleanMoney = (value: string) => value.replace(/[,\s$]/g, '');

export default function QuoteDetailScreen({ deal = false }: { deal?: boolean }) {
  const params = useParams();
  const id = params.id ?? params.quoteId ?? '';
  const session = useDemoStore((state) => state.session);
  const [quote, setQuote] = useState<Quote | null | undefined>(undefined);
  const [request, setRequest] = useState<BuyerRequest | null | undefined>(undefined);
  const [competing, setCompeting] = useState<Quote[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ vehiclePrice: '', docFee: '', titleReg: '', tradeInCredit: '' });
  const [newFile, setNewFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [priceSent, setPriceSent] = useState(false);
  const [reviseError, setReviseError] = useState('');
  const [highlight, setHighlight] = useState(false);
  const breakdownRef = useRef<HTMLElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const [attachments, setAttachments] = useState<DealDocument[]>([]);
  const [selectedImage, setSelectedImage] = useState(0);

  const refresh = () => {
    void client.quotes.get(id).then(async (row) => {
      setQuote(row);
      const lookup = session?.role === 'buyer' ? client.requests.get : client.feed.get;
      void lookup(row.requestId).then(setRequest).catch(() => setRequest(null));
      void client.quotes.list(row.requestId).then((rows) => setCompeting(rows.filter((item) => !['withdrawn', 'expired'].includes(item.status)).sort((a, b) => Number(a.finalPrice) - Number(b.finalPrice)))).catch(() => setCompeting([]));
    }).catch(() => setQuote(null));
    void client.documents.list(id).then((rows) => { setAttachments(rows); setSelectedImage(0); }).catch(() => setAttachments([]));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { setQuote(undefined); setRequest(undefined); setCompeting([]); refresh(); }, [id]);

  if (quote === undefined || (quote && request === undefined)) return <PageLoading label="Opening quote" />;
  if (!quote || !request) return <div className="shell page-content"><section className="card card-pad"><h1>Quote not found</h1><p className="muted">This quote may no longer be available in your workspace.</p><Link className="button button-primary" to="/quotes">Back to quotes</Link></section></div>;

  const rank = competing.findIndex((item) => item.id === quote.id) + 1;
  const leader = competing[0];
  const gap = leader ? Number(quote.finalPrice) - Number(leader.finalPrice) : 0;
  const images = attachments.filter((item) => item.type === 'vehicle_image' && item.downloadUrl);
  const documents = attachments.filter((item) => item.type !== 'vehicle_image' && item.downloadUrl);
  const canRevise = session?.role === 'dealer' && ['pending', 'negotiating'].includes(quote.status);
  const currentDocument = documents[0] ?? null;
  const lastRevision = quote.revisions?.at(-1);
  const draftAmounts = { vehiclePrice: cleanMoney(draft.vehiclePrice), docFee: cleanMoney(draft.docFee), titleReg: cleanMoney(draft.titleReg), tradeInCredit: cleanMoney(draft.tradeInCredit) };
  const amountsValid = Object.values(draftAmounts).every((value) => MONEY.test(value));
  const draftTax = (Number(draftAmounts.vehiclePrice || 0) * SALES_TAX_RATE).toFixed(2);
  const draftTotal = amountsValid ? computeOtd({ ...draftAmounts, salesTax: draftTax }) : null;
  const pricesChanged = (['vehiclePrice', 'docFee', 'titleReg', 'tradeInCredit'] as const).some((key) => Number(draftAmounts[key]) !== Number(quote[key]));
  const accepted = quote.status === 'accepted';

  function goToBreakdown() {
    breakdownRef.current?.scrollIntoView({ behavior: smoothScroll(), block: 'center' });
    setHighlight(true);
    window.setTimeout(() => setHighlight(false), 1600);
    window.setTimeout(() => editButtonRef.current?.focus({ preventScroll: true }), 400);
  }

  function startEditing() {
    setDraft({ vehiclePrice: quote!.vehiclePrice, docFee: quote!.docFee, titleReg: quote!.titleReg, tradeInCredit: quote!.tradeInCredit });
    setNewFile(null);
    setReviseError('');
    setPriceSent(false);
    setEditing(true);
  }

  function stopEditing() {
    setEditing(false);
    setNewFile(null);
    setReviseError('');
    setPriceSent(false);
  }

  function pickDocument(file: File | undefined) {
    if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) { setReviseError('Choose a PDF, DOC or DOCX file.'); return; }
    if (file.size > DOCUMENT_LIMIT_BYTES) { setReviseError('That file is over 20 MB. Choose a smaller one.'); return; }
    setReviseError('');
    setNewFile(file);
  }

  async function sendRevision() {
    if (saving) return;
    if (!amountsValid) { setReviseError('Enter each amount as a number, like 1250 or 1250.50.'); return; }
    if (Number(draftAmounts.vehiclePrice) <= 0) { setReviseError('Vehicle price must be more than 0.'); return; }
    if (!pricesChanged && !newFile) { setReviseError('Change a price or choose a new document before sending.'); return; }
    setSaving(true);
    setReviseError('');
    let priceDone = priceSent;
    try {
      if (pricesChanged && !priceDone) {
        await client.quotes.revise(quote!.id, { ...draftAmounts, salesTax: draftTax });
        priceDone = true;
        setPriceSent(true);
      }
      if (newFile) await client.documents.replace(quote!.id, newFile, currentDocument);
      stopEditing();
      refresh();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'Please try again.';
      setReviseError(priceDone ? `Your new price was sent, but the document could not be updated: ${reason}` : `The revision could not be sent: ${reason}`);
      if (priceDone) refresh();
    } finally {
      setSaving(false);
    }
  }

  return <div className="shell page-content quote-detail-page">
    <Link className="button button-ghost" to={deal ? session?.role === 'buyer' ? '/orders' : '/deals' : session?.role === 'buyer' ? `/requests/${request.id}` : '/quotes'}><ArrowLeft size={17} /> Back</Link>
    <div className="page-heading quote-detail-heading"><div><span className="eyebrow">{deal ? 'Accepted deal' : 'Dealer quote'} · {request.brand} {request.model}</span><h1>{formatMoney(quote.finalPrice)} out the door</h1><p>{quote.dealerName} · {quote.dealerCity} · valid through {new Date(quote.expiresAt).toLocaleDateString('en-US')}</p></div>{!deal && <StatusBadge status={quote.status} />}</div>
    {session?.role === 'dealer' && !accepted && <section className={`quote-position ${rank === 1 ? 'leading' : 'behind'}`}>{rank === 1 ? <Trophy /> : <TrendingDown />}<div><span className="eyebrow">Live position · #{rank} of {competing.length}</span><h2>{rank === 1 ? 'You are leading this request.' : 'A revision may improve your position.'}</h2><p>{rank === 1 ? `Your offer is ${formatMoney(Math.max(0, Number(competing[1]?.finalPrice ?? quote.finalPrice) - Number(quote.finalPrice)))} below the next dealer.` : `The current leading offer is ${formatMoney(gap)} lower. Buyer identity remains protected.`}</p></div>{canRevise && <button className="button button-secondary" onClick={goToBreakdown}><Pencil size={17} /> Revise price</button>}</section>}
    {accepted && session?.role === 'dealer' && <section className="quote-position accepted"><CheckCircle2 /><div><span className="eyebrow">Buyer accepted your offer</span><h2>Contact and realtime chat are now open.</h2></div><Link className="button button-primary" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Message buyer</Link></section>}
    <div className="detail-grid"><main className="grid">
      <section className={`card quote-gallery ${images.length ? '' : 'quote-gallery-empty'}`}>
        {images.length ? <><div className="quote-gallery-main"><img src={images[selectedImage]?.downloadUrl ?? images[0]!.downloadUrl} alt={`${request.brand} ${request.model} supplied by ${quote.dealerName}`} /></div><div className="quote-gallery-thumbs">{images.map((image, index) => <button type="button" className={selectedImage === index ? 'active' : ''} onClick={() => setSelectedImage(index)} key={image.id} aria-label={`View dealer vehicle photo ${index + 1}`}><img src={image.downloadUrl} alt="" loading="lazy" /></button>)}<span><Image size={18} /> {images.length} dealer-supplied {images.length === 1 ? 'photo' : 'photos'}</span></div></> : <div className="quote-media-empty"><span><ImageOff /></span><h3>No vehicle photos supplied</h3><p>This quote includes pricing only. Deal&amp;Drive does not substitute stock or demo images.</p></div>}
      </section>
      <section ref={breakdownRef} className={`card card-pad quote-breakdown${highlight ? ' is-highlighted' : ''}`}>
        <div className="quote-breakdown-head"><span className="eyebrow">Out-the-door breakdown</span>{canRevise && !editing && <button ref={editButtonRef} type="button" className="button button-secondary button-sm" onClick={startEditing}><Pencil size={15} /> Edit</button>}</div>
        {lastRevision && <div className="quote-revised" role="status"><History size={18} /><span><strong>Price revised</strong><small>{lastRevision.amount ? `Was ${formatMoney(lastRevision.amount, true)}, now ${formatMoney(quote.finalPrice, true)}` : `Now ${formatMoney(quote.finalPrice, true)}`}{lastRevision.at ? ` · ${formatLongDate(lastRevision.at)}` : ''}</small></span></div>}
        {editing ? <form className="quote-edit" onSubmit={(event) => { event.preventDefault(); void sendRevision(); }} noValidate>
          <div className="quote-edit-grid">
            <MoneyField id="revised-vehicle-price" label="Vehicle price" value={draft.vehiclePrice} onChange={(value) => setDraft((current) => ({ ...current, vehiclePrice: value }))} />
            <MoneyField id="revised-doc-fee" label="Documentation fee" value={draft.docFee} onChange={(value) => setDraft((current) => ({ ...current, docFee: value }))} />
            <div className="field"><span className="field-label">Sales tax <small>(6.25% of the vehicle price)</small></span><strong className="price quote-edit-static">{formatMoney(draftTax, true)}</strong></div>
            <MoneyField id="revised-title-reg" label="Title & registration" value={draft.titleReg} onChange={(value) => setDraft((current) => ({ ...current, titleReg: value }))} />
            <MoneyField id="revised-trade-in" label="Trade-in credit" value={draft.tradeInCredit} onChange={(value) => setDraft((current) => ({ ...current, tradeInCredit: value }))} />
            <div className="field"><span className="field-label">Final total</span><strong className="price quote-total quote-edit-static">{draftTotal === null ? '—' : formatMoney(draftTotal, true)}</strong></div>
          </div>
          {reviseError && <div className="inline-warning" role="alert">{reviseError}</div>}
          <div className="quote-edit-actions"><button type="button" className="button button-ghost" onClick={stopEditing} disabled={saving}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Sending…' : 'Send revised price'}</button></div>
        </form> : <div className="spec-list">
          <div className="spec"><span>Vehicle price</span><strong className="price">{formatMoney(quote.vehiclePrice, true)}</strong></div>
          <div className="spec"><span>Documentation fee</span><strong className="price">{formatMoney(quote.docFee, true)}</strong></div>
          <div className="spec"><span>Sales tax <small>(6.25% of the vehicle price)</small></span><strong className="price">{formatMoney(quote.salesTax, true)}</strong></div>
          <div className="spec"><span>Title &amp; registration</span><strong className="price">{formatMoney(quote.titleReg, true)}</strong></div>
          <div className="spec"><span>Trade-in credit</span><strong className="price">−{formatMoney(quote.tradeInCredit, true)}</strong></div>
          <div className="spec"><span>Final total</span><strong className="price quote-total">{formatMoney(quote.finalPrice, true)}</strong></div>
        </div>}
        <blockquote className="dealer-note">“{quote.message}”</blockquote>
      </section>
    </main><aside className="sticky-card grid"><section className="card card-pad quote-contact-card"><span className="quote-contact-icon"><ShieldCheck size={22} /></span><h3>{quote.contactAvailable ? 'Contact is unlocked' : 'Buyer identity is protected'}</h3><p className="muted">{quote.contactAvailable ? 'The accepted quote or approved negotiation opened this private conversation.' : 'Contact opens only after acceptance or an approved negotiation request.'}</p>{quote.contactAvailable && <Link className="button button-primary button-wide" to={`/chat/${quote.id}`}><MessageCircle size={17} /> Open conversation</Link>}</section><section className="card card-pad quote-documents"><span className="eyebrow">Dealer document</span><h3>Quote attachment</h3>{editing ? <>
    {currentDocument && <div className="document-row is-static"><FileCheck2 size={18} /><span><strong>{currentDocument.name}</strong><small>{newFile ? 'Replaced when you send' : 'Current document'}</small></span></div>}
    <label className="upload-zone compact" htmlFor="revised-document"><FileUp /><span><strong>{newFile ? 'Choose a different file' : currentDocument ? 'Replace this document' : 'Attach a document'}</strong><small>PDF, DOC or DOCX · up to 20 MB</small></span><input id="revised-document" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { pickDocument(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {newFile && <span className="uploaded-file"><FileUp size={15} /><span><strong>{newFile.name}</strong><small>{(newFile.size / 1024 / 1024).toFixed(1)} MB · replaces the current document</small></span><button type="button" onClick={() => setNewFile(null)} aria-label={`Remove ${newFile.name}`}>Remove</button></span>}
  </> : documents.length ? documents.map((document) => <a className="document-row" href={document.downloadUrl} download={document.name} key={document.id} aria-label={`Download ${document.name}`}><FileCheck2 size={18} /><span><strong>{document.name}</strong><small>Secure download · {document.status}</small></span><Download size={17} /></a>) : <div className="document-empty"><FileCheck2 /><p><strong>No document attached</strong><small>The dealer submitted this quote without a downloadable document.</small></p></div>}</section></aside></div>
  </div>;
}


/** A dollar amount input: the $ sits inside the box and the value is validated when the revision is sent. */
function MoneyField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="field"><label htmlFor={id}>{label}</label><div className="money-input"><span aria-hidden="true">$</span><input id={id} className="input price" value={value} onChange={(event) => onChange(event.target.value)} inputMode="decimal" autoComplete="off" /></div></div>;
}
