import { ArrowLeft, ArrowRight, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gateReasonFor, planTone, subscriptionGate } from '@/helpers/subscription';
import type { SubscriptionGate } from '@/helpers/subscription';
import { client } from '@/services/platform/client';
import { useDemoStore } from '@/services/platform/demoStore';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import { PageLoading } from '@/ui/reusables/PageLoading/PageLoading';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { UpgradePrompt } from '@/ui/reusables/UpgradePrompt/UpgradePrompt';
import { UsageChip } from '@/ui/reusables/UsageMeter/UsageMeter';
import type { BrandRef, BuyerRequest, StateRef } from '@/types/domain';

const timelineOptions: Array<{ value: BuyerRequest['timeline']; label: string; help: string }> = [
  { value: 'ASAP', label: 'Ready when the right offer arrives', help: 'Dealers know you are ready to decide.' },
  { value: 'Within 1 week', label: 'Planning to decide within a week', help: 'Best for a near-term purchase.' },
  { value: 'Within 2 weeks', label: 'Planning to decide within 2–4 weeks', help: 'Room to compare and arrange finance.' },
  { value: 'Just exploring', label: 'Researching options for now', help: 'No immediate purchase pressure.' },
];

const choices = (items: string[]) => items.map((item) => ({ value: item, label: item }));
const withNoPreference = (items: string[]) => [{ value: '', label: 'No preference' }, ...choices(items)];
const bodyOptions = withNoPreference(['SUV', 'Sedan', 'Hatchback', 'Truck', 'Sports Car']);
const fuelOptions = withNoPreference(['Gasoline', 'Hybrid', 'Electric', 'Diesel']);
const drivetrainOptions = withNoPreference(['FWD', 'RWD', 'AWD', '4WD']);
const transmissionOptions = withNoPreference(['Automatic', 'Manual']);
const radiusOptions = [25, 50, 100, 250].map((miles) => ({ value: String(miles), label: `Within ${miles} miles` }));

export default function NewRequestScreen() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [brands, setBrands] = useState<BrandRef[]>([]);
  const [states, setStates] = useState<StateRef[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [refLoaded, setRefLoaded] = useState(false);
  const [error, setError] = useState('');
  const subscription = useDemoStore((state) => state.session?.subscription ?? null);
  const setSession = useDemoStore((state) => state.setSession);
  const [gate, setGate] = useState<SubscriptionGate | null>(null);
  const blocked = subscription !== null && !subscription.canCreate;
  const [form, setForm] = useState({ brandId: '', model: '', bodyType: 'SUV', fuel: '', yearMin: '2024', yearMax: '2026', trim: '', drivetrain: '', transmission: '', color: '', area: 'Frisco', stateId: '', radius: '50', timeline: 'Within 2 weeks' as BuyerRequest['timeline'], details: '' });
  const set = useCallback((key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value })), []);

  useEffect(() => {
    void Promise.all([
      client.reference.brands().then((rows) => { setBrands(rows); set('brandId', rows[0]?.id ?? ''); }).catch(() => setBrands([])),
      client.reference.states().then((rows) => { setStates(rows); set('stateId', rows[0]?.id ?? ''); }).catch(() => setStates([])),
    ]).then(() => setRefLoaded(true));
  }, [set]);

  async function publish() {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await client.requests.create({
        brandId: form.brandId, buyerAreaStateId: form.stateId, model: form.model, bodyType: form.bodyType || null,
        fuelType: form.fuel || null, yearMin: Number(form.yearMin) || null, yearMax: Number(form.yearMax) || null,
        trim: form.trim || null, drivetrain: form.drivetrain || null, transmission: form.transmission || null, color: form.color || null,
        buyerArea: `${form.area}, ${states.find((item) => item.id === form.stateId)?.name ?? ''}`, searchRadiusMiles: Number(form.radius),
        timeline: form.timeline, mustHaves: [form.trim, form.drivetrain, form.transmission, form.color, form.details].filter(Boolean),
        requestExpire: new Date(Date.now() + 14 * 86_400_000).toISOString(), status: 'open',
      });
      void client.auth.me().then(setSession).catch(() => undefined);
      navigate(`/requests/${created.id}`);
    } catch (cause) {
      const refusal = subscriptionGate(cause);
      if (refusal) setGate(refusal);
      else setError(cause instanceof Error ? cause.message : 'This request could not be published. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const timeline = timelineOptions.find((item) => item.value === form.timeline)!;
  const brandName = brands.find((item) => item.id === form.brandId)?.name ?? '';
  const stateName = states.find((item) => item.id === form.stateId)?.name ?? '';
  if (!refLoaded) return <PageLoading label="Getting your request form ready" />;
  return <div className="shell page-content request-builder">
    <Link to="/requests" className="button button-ghost"><ArrowLeft size={17} /> Back to requests</Link>
    <div className="page-heading request-builder-heading"><div><span className="eyebrow">Private buyer brief · Step {step} of 2</span><h1>{step === 1 ? 'Tell dealers exactly what fits.' : 'Review the brief dealers will receive.'}</h1><p>{step === 1 ? 'This is a buying request—not a vehicle listing. No photos, contact details, or target price are shared.' : 'Your identity remains private until you accept an offer or open a negotiation.'}</p></div><div className="request-stepper"><i className="active" /><i className={step === 2 ? 'active' : ''} /></div></div>
    {subscription && planTone(subscription) !== 'premium' && <div className="plan-strip"><UsageChip subscription={subscription} /></div>}
    {(gate || blocked) && <UpgradePrompt reason={gate?.reason ?? (subscription ? gateReasonFor(subscription) : null)} role="buyer" limit={gate?.limit ?? subscription?.limit ?? null} subscription={subscription} reveal={gate !== null} />}
    {step === 1 ? <section className="card request-form-card"><div className="request-form-intro"><span><strong>Not sure about a specification?</strong><small>Leave optional fields blank, or have Sera fill out this brief with you.</small></span><Link to="/chatbot?prompt=request" className="serra-ask-chip"><SerraLogo size={22} title={null} /><span>Ask Sera</span><ArrowRight size={15} /></Link></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
      <div className="field"><label htmlFor="request-brand">Brand</label><Dropdown id="request-brand" ariaLabel="Brand" align="left" value={form.brandId} onChange={(value) => set('brandId', value)} options={brands.map((item) => ({ value: item.id, label: item.name }))} /></div>
      <div className="field"><label>Model</label><input className="input" value={form.model} onChange={(event) => set('model', event.target.value)} placeholder="e.g. Bronco" required /></div>
      <div className="field"><label htmlFor="request-body">Body style <span className="muted">(optional)</span></label><Dropdown id="request-body" ariaLabel="Body style" align="left" value={form.bodyType} onChange={(value) => set('bodyType', value)} options={bodyOptions} /></div>
      <div className="field"><label htmlFor="request-fuel">Fuel type <span className="muted">(optional)</span></label><Dropdown id="request-fuel" ariaLabel="Fuel type" align="left" value={form.fuel} onChange={(value) => set('fuel', value)} options={fuelOptions} /></div>
      <div className="field"><label>Earliest model year</label><input className="input" type="number" value={form.yearMin} onChange={(event) => set('yearMin', event.target.value)} min="2000" max="2027" /></div>
      <div className="field"><label>Latest model year</label><input className="input" type="number" value={form.yearMax} onChange={(event) => set('yearMax', event.target.value)} min="2000" max="2027" /></div>
      <div className="field"><label>Trim <span className="muted">(optional)</span></label><input className="input" value={form.trim} onChange={(event) => set('trim', event.target.value)} placeholder="e.g. Outer Banks" /></div>
      <div className="field"><label htmlFor="request-drivetrain">Drivetrain <span className="muted">(optional)</span></label><Dropdown id="request-drivetrain" ariaLabel="Drivetrain" align="left" value={form.drivetrain} onChange={(value) => set('drivetrain', value)} options={drivetrainOptions} /></div>
      <div className="field"><label htmlFor="request-transmission">Transmission <span className="muted">(optional)</span></label><Dropdown id="request-transmission" ariaLabel="Transmission" align="left" value={form.transmission} onChange={(value) => set('transmission', value)} options={transmissionOptions} /></div>
      <div className="field"><label>Exterior colour <span className="muted">(optional)</span></label><input className="input" value={form.color} onChange={(event) => set('color', event.target.value)} placeholder="Any colour" /></div>
      <div className="field"><label>Search area</label><input className="input" value={form.area} onChange={(event) => set('area', event.target.value)} required /></div>
      <div className="field"><label htmlFor="request-state">State</label><Dropdown id="request-state" ariaLabel="State" align="left" value={form.stateId} onChange={(value) => set('stateId', value)} options={states.map((item) => ({ value: item.id, label: item.name }))} /></div>
      <div className="field"><label htmlFor="request-radius">Dealer radius</label><Dropdown id="request-radius" ariaLabel="Dealer radius" align="left" value={form.radius} onChange={(value) => set('radius', value)} options={radiusOptions} /></div>
      <div className="field"><label htmlFor="request-timeline">When are you planning to decide?</label><Dropdown id="request-timeline" ariaLabel="When are you planning to decide?" align="left" value={form.timeline} onChange={(value) => set('timeline', value)} options={timelineOptions} /><small className="field-hint">{timeline.help}</small></div>
      <div className="field form-span"><label>Anything else dealers should know? <span className="muted">(optional)</span></label><textarea className="textarea" value={form.details} onChange={(event) => set('details', event.target.value)} placeholder="Must-have equipment, accessibility needs, preferred delivery timing…" rows={4} /></div>
      <div className="form-span request-form-actions"><Link className="button button-secondary" to="/chatbot?prompt=request">Build with Sera</Link><button className="button button-primary" disabled={!form.model}>Review private brief <ArrowRight size={17} /></button></div>
    </form></section> : <div className="detail-grid"><section className="card card-pad request-review"><span className="eyebrow">Dealer-facing brief</span><h2>{brandName} {form.model}</h2><div className="request-review-location"><MapPin size={18} /><span><strong>{form.area}, {stateName}</strong><small>Dealers within {form.radius} miles</small></span></div><div className="spec-list"><div className="spec"><span>Model years</span><strong>{form.yearMin}–{form.yearMax}</strong></div><div className="spec"><span>Body / fuel</span><strong>{[form.bodyType, form.fuel].filter(Boolean).join(' · ') || 'No preference'}</strong></div><div className="spec"><span>Timing</span><strong>{timeline.label}</strong></div><div className="spec"><span>Preferences</span><strong>{[form.trim, form.drivetrain, form.transmission, form.color].filter(Boolean).join(' · ') || 'Open to options'}</strong></div><div className="spec"><span>Additional notes</span><strong>{form.details || 'Nothing else added'}</strong></div></div>{error && <div className="inline-warning" role="alert">{error}</div>}<div className="request-form-actions"><button className="button button-secondary" onClick={() => setStep(1)}><ArrowLeft size={17} /> Edit brief</button><button className="button button-primary" disabled={submitting || blocked} onClick={() => void publish()}><CheckCircle2 size={17} /> {submitting ? 'Publishing…' : 'Publish to verified dealers'}</button></div></section><aside className="card card-pad privacy-card"><div className="privacy-icon"><ShieldCheck /></div><span className="eyebrow">Privacy gate</span><h3>What stays hidden</h3><p>Your name, email, phone number, exact address, and AI-inferred budget are never shown in this brief.</p><p>Contact opens only after you accept an offer or a dealer accepts your negotiation request.</p></aside></div>}
  </div>;
}
