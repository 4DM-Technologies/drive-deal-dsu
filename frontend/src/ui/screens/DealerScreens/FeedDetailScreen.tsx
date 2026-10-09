import { ArrowLeft, Calculator, Check, FileUp, ImagePlus, MapPin, Send, ShieldCheck, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { computeOtd, formatMoney } from '@/helpers/currency';
import { gateReasonFor, planTone, subscriptionGate } from '@/helpers/subscription';
import type { SubscriptionGate } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { UpgradePrompt } from '@/ui/reusables/UpgradePrompt/UpgradePrompt';
import { UsageChip } from '@/ui/reusables/UsageMeter/UsageMeter';
import type { BuyerRequest, Quote } from '@/types/domain';

export default function FeedDetailScreen() {
  const { requestId = '' } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState<BuyerRequest | null | undefined>(undefined);
  const [vehiclePrice, setVehiclePrice] = useState('');
  const [docFee, setDocFee] = useState('');
  const [titleReg, setTitleReg] = useState('');
  const [trade, setTrade] = useState('');
  const [message, setMessage] = useState('');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingUploadQuote, setPendingUploadQuote] = useState<Quote | null>(null);
  const subscription = useDemoStore((state) => state.session?.subscription ?? null);
  const setSession = useDemoStore((state) => state.setSession);
  const [gate, setGate] = useState<SubscriptionGate | null>(null);
  const blocked = subscription !== null && !subscription.canCreate;
  // The API allows one quote per dealer per request and answers a second one with a server error, so
  // look for an existing quote up front instead of letting the dealer hit that.
  const [existingQuote, setExistingQuote] = useState<Quote | null>(null);

  useEffect(() => { void client.feed.get(requestId).then(setRequest).catch(() => setRequest(null)); }, [requestId]);
  useEffect(() => { void client.quotes.list().then((rows) => setExistingQuote(rows.find((quote) => quote.requestId === requestId) ?? null)).catch(() => undefined); }, [requestId]);
  const images = useMemo(() => imageFiles.map((file) => ({ file, url: URL.createObjectURL(file) })), [imageFiles]);
  useEffect(() => () => images.forEach(({ url }) => URL.revokeObjectURL(url)), [images]);
  const tax = useMemo(() => vehiclePrice ? (Number(vehiclePrice) * .0625).toFixed(2) : '', [vehiclePrice]);
  const total = computeOtd({ vehiclePrice, docFee, salesTax: tax, titleReg, tradeInCredit: trade });

  if (request === undefined) return <PageLoading label="Opening buyer brief" />;
  if (!request) return <div className="shell page-content"><section className="card card-pad"><h1>Request not found</h1><p className="muted">This buying request may have closed or moved outside your matched area.</p><Link className="button button-primary" to="/feed">Back to buyer feed</Link></section></div>;

  async function uploadPendingAttachments(quoteId: string) {
    for (const file of imageFiles) {
      await client.documents.upload(quoteId, file, 'vehicle_image');
      setImageFiles((files) => files.filter((item) => item !== file));
    }
    if (documentFile) {
      await client.documents.upload(quoteId, documentFile, 'quote_document');
      setDocumentFile(null);
    }
  }

  async function retryAttachments() {
    if (!pendingUploadQuote || submitting) return;
    setSubmitting(true);
    setUploadError('');
    try {
      await uploadPendingAttachments(pendingUploadQuote.id);
      navigate(`/quotes/${pendingUploadQuote.id}`);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'The attachment could not be uploaded. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submit() {
    if (submitting || existingQuote) return;
    setSubmitting(true);
    setUploadError('');
    let createdQuote: Quote | null = null;
    try {
      const created = await client.quotes.create({ buyerRequestId: request!.id, vehiclePrice, docFee: Number(docFee || 0).toFixed(2), salesTax: tax, titleReg: Number(titleReg || 0).toFixed(2), tradeInCredit: Number(trade || 0).toFixed(2), message, expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() });
      createdQuote = created;
      // The quote exists from here on, so a failed upload below must not let the form send it again.
      setExistingQuote(created);
      setPendingUploadQuote(created);
      await uploadPendingAttachments(created.id);
      setPendingUploadQuote(null);
      void client.auth.me().then(setSession).catch(() => undefined);
      navigate(`/quotes/${created.id}`);
    } catch (cause) {
      const refusal = subscriptionGate(cause);
      if (refusal) setGate(refusal);
      else if (createdQuote) {
        setPendingUploadQuote(createdQuote);
        setUploadError('Your quote was created, but an attachment did not reach storage. Retry the upload below; this will not create a second quote.');
      } else setUploadError(cause instanceof Error ? cause.message : 'The quote could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return <div className="shell page-content quote-create-page">
    <Link className="button button-ghost" to="/feed"><ArrowLeft size={17} /> Back to feed</Link>
    <div className="page-heading request-detail-heading"><div><span className="eyebrow">Buyer request · Identity protected</span><h1>{request.brand} {request.model}</h1><p>{request.yearMin}–{request.yearMax} · {request.bodyType} · {request.timeline}</p></div><div className="distance-chip"><MapPin size={16} /><span><strong>Approx. 12 miles away</strong><small>{request.area} · within {request.radiusMiles} mi</small></span></div></div>
    {subscription && planTone(subscription) !== 'premium' && <div className="plan-strip"><UsageChip subscription={subscription} /></div>}
    {(gate || blocked) && <UpgradePrompt reason={gate?.reason ?? (subscription ? gateReasonFor(subscription) : null)} role="dealer" limit={gate?.limit ?? subscription?.limit ?? null} subscription={subscription} reveal={gate !== null} />}
    {existingQuote && <div className="inline-success" role="status"><Check size={18} />You have already sent a quote for this request. <Link to={`/quotes/${existingQuote.id}`}>View your quote</Link></div>}
    <div className="detail-grid"><section className="card card-pad quote-builder"><span className="eyebrow">Transparent dealer response</span><h2>Build your itemized quote</h2>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="field form-span"><label htmlFor="vehicle-price">Vehicle price</label><input id="vehicle-price" name="vehiclePrice" className="input price" type="number" min="0" step="0.01" placeholder="Enter the price you’re offering…" value={vehiclePrice} onChange={(event) => setVehiclePrice(event.target.value)} inputMode="decimal" required /></div>
        <div className="field"><label htmlFor="doc-fee">Documentation fee <span className="muted">(optional)</span></label><input id="doc-fee" name="docFee" className="input price" type="number" min="0" step="0.01" placeholder="0.00" value={docFee} onChange={(event) => setDocFee(event.target.value)} inputMode="decimal" /></div>
        <div className="field"><label htmlFor="sales-tax">Sales tax <span className="muted">(6.25%)</span></label><input id="sales-tax" className="input price" value={tax} placeholder="Calculated from vehicle price" readOnly /></div>
        <div className="field"><label htmlFor="title-registration">Title &amp; registration <span className="muted">(optional)</span></label><input id="title-registration" name="titleRegistration" className="input price" type="number" min="0" step="0.01" placeholder="0.00" value={titleReg} onChange={(event) => setTitleReg(event.target.value)} inputMode="decimal" /></div>
        <div className="field"><label htmlFor="trade-credit">Trade-in credit <span className="muted">(optional)</span></label><input id="trade-credit" name="tradeCredit" className="input price" type="number" min="0" step="0.01" placeholder="0.00" value={trade} onChange={(event) => setTrade(event.target.value)} inputMode="decimal" /></div>
        <div className="field form-span"><label htmlFor="vehicle-photos">Vehicle photos <span className="muted">(optional · up to 8)</span></label><label className="upload-zone" htmlFor="vehicle-photos"><ImagePlus /><span><strong>Add actual vehicle photos</strong><small>JPG, PNG or WebP · each up to 12 MB</small></span><input id="vehicle-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setImageFiles(Array.from(event.target.files ?? []).slice(0, 8))} /></label>{images.length > 0 && <div className="upload-preview">{images.map(({ file, url }, index) => <figure key={`${file.name}-${file.lastModified}`}><img src={url} alt={`Vehicle preview ${index + 1}`} /><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setImageFiles((files) => files.filter((item) => item !== file))}><X size={14} /></button></figure>)}</div>}</div>
        <div className="field form-span"><label htmlFor="quote-document">Quote document <span className="muted">(optional · one file)</span></label><label className="upload-zone compact" htmlFor="quote-document"><FileUp /><span><strong>{documentFile ? 'Replace selected document' : 'Attach a window sticker or buyer order'}</strong><small>PDF, DOC or DOCX · up to 20 MB · downloaded securely by the buyer</small></span><input id="quote-document" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)} /></label>{documentFile && <span className="uploaded-file"><FileUp size={15} /><span><strong>{documentFile.name}</strong><small>{(documentFile.size / 1024 / 1024).toFixed(1)} MB</small></span><button type="button" onClick={() => setDocumentFile(null)} aria-label={`Remove ${documentFile.name}`}>Remove</button></span>}</div>
        <div className="field form-span"><label htmlFor="buyer-message">Message to buyer</label><textarea id="buyer-message" name="buyerMessage" className="textarea" value={message} onChange={(event) => setMessage(event.target.value)} rows={4} placeholder="Share availability, included equipment, or delivery details…" required /></div>
        {uploadError && <div className="inline-warning form-span" role="alert"><p>{uploadError}</p>{pendingUploadQuote && <button type="button" className="button button-secondary button-sm" onClick={() => void retryAttachments()} disabled={submitting || (!imageFiles.length && !documentFile)}>{submitting ? 'Retrying upload…' : 'Retry attachment upload'}</button>}</div>}
        <div className="form-span quote-total-bar"><span><small>Out-the-door total</small><strong className="price">{vehiclePrice ? formatMoney(total, true) : 'Add a vehicle price to calculate'}</strong></span><button className="button button-primary" disabled={submitting || existingQuote !== null}><Send size={17} /> {submitting ? 'Uploading quote…' : 'Send itemized quote'}</button></div>
      </form>
    </section><aside className="sticky-card grid"><section className="card card-pad"><Calculator color="var(--accent)" /><h3>The complete total competes</h3><p className="muted">Vehicle price + documentation fee + sales tax + title and registration − trade-in credit.</p><div className="spec-list single"><div className="spec"><span>Buyer timing</span><strong>{request.timeline}</strong></div><div className="spec"><span>Buyer area</span><strong>{request.area}</strong></div><div className="spec"><span>Fuel &amp; transmission</span><strong>{[request.fuelType || 'Any fuel', request.transmission || 'Any transmission'].join(' · ')}</strong></div><div className="spec"><span>Requested features</span><strong>{request.mustHaves.join(', ') || 'Open to options'}</strong></div>{request.additionalInformation && <div className="spec"><span>Additional details</span><strong>{request.additionalInformation}</strong></div>}</div></section><section className="card card-pad privacy-note"><ShieldCheck /><div><h3>Identity remains private</h3><p>You see the approximate area only. Contact opens if the buyer accepts or you accept their negotiation request.</p></div></section></aside></div>
  </div>;
}
