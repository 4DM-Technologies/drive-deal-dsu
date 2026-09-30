import { ArrowLeft, ArrowRight, CheckCircle2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { brands, states } from '@/services/mocks/fixtures';
import { useDemoStore } from '@/services/platform/demoStore';
import type { BuyerRequest } from '@/types/domain';

const timelineOptions: Array<{ value: BuyerRequest['timeline']; label: string; help: string }> = [
  { value: 'ASAP', label: 'Ready when the right offer arrives', help: 'Dealers know you are ready to decide.' },
  { value: 'Within 1 week', label: 'Planning to decide within a week', help: 'Best for a near-term purchase.' },
  { value: 'Within 2 weeks', label: 'Planning to decide within 2–4 weeks', help: 'Room to compare and arrange finance.' },
  { value: 'Just exploring', label: 'Researching options for now', help: 'No immediate purchase pressure.' },
];

export default function NewRequestScreen() {
  const session = useDemoStore((state) => state.session);
  const addRequest = useDemoStore((state) => state.addRequest);
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ brand: 'Ford', model: '', bodyType: 'SUV', fuel: '', yearMin: '2024', yearMax: '2026', trim: '', drivetrain: '', transmission: '', color: '', area: 'Frisco', state: 'Texas', radius: '50', timeline: 'Within 2 weeks' as BuyerRequest['timeline'], details: '' });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  function publish() {
    const id = `req-${crypto.randomUUID()}`;
    addRequest({ id, buyerId: session?.id ?? 'buyer-rahul', brand: form.brand, model: form.model, bodyType: form.bodyType || null, yearMin: Number(form.yearMin) || null, yearMax: Number(form.yearMax) || null, budgetMin: null, budgetMax: null, targetOtdPrice: null, area: `${form.area}, ${form.state}`, radiusMiles: Number(form.radius), timeline: form.timeline, status: 'open', quoteCount: 0, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), image: '', mustHaves: [form.trim, form.drivetrain, form.transmission, form.color, form.details].filter(Boolean) });
    navigate(`/requests/${id}`);
  }

  const timeline = timelineOptions.find((item) => item.value === form.timeline)!;
  return <div className="shell page-content request-builder">
    <Link to="/requests" className="button button-ghost"><ArrowLeft size={17} /> Back to requests</Link>
    <div className="page-heading request-builder-heading"><div><span className="eyebrow">Private buyer brief · Step {step} of 2</span><h1>{step === 1 ? 'Tell dealers exactly what fits.' : 'Review the brief dealers will receive.'}</h1><p>{step === 1 ? 'This is a buying request—not a vehicle listing. No photos, contact details, or target price are shared.' : 'Your identity remains private until you accept an offer or open a negotiation.'}</p></div><div className="request-stepper"><i className="active" /><i className={step === 2 ? 'active' : ''} /></div></div>
    {step === 1 ? <section className="card request-form-card"><div className="request-form-intro"><Sparkles size={20} /><span><strong>Not sure about a specification?</strong><small>Leave optional fields blank or <Link to="/chatbot?prompt=request">build the brief with Serra</Link>.</small></span></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
      <div className="field"><label>Brand</label><select className="select" value={form.brand} onChange={(event) => set('brand', event.target.value)}>{brands.map((item) => <option key={item}>{item}</option>)}</select></div>
      <div className="field"><label>Model</label><input className="input" value={form.model} onChange={(event) => set('model', event.target.value)} placeholder="e.g. Bronco" required /></div>
      <div className="field"><label>Body style <span className="muted">(optional)</span></label><select className="select" value={form.bodyType} onChange={(event) => set('bodyType', event.target.value)}><option value="">No preference</option><option>SUV</option><option>Sedan</option><option>Hatchback</option><option>Truck</option><option>Sports Car</option></select></div>
      <div className="field"><label>Fuel type <span className="muted">(optional)</span></label><select className="select" value={form.fuel} onChange={(event) => set('fuel', event.target.value)}><option value="">No preference</option><option>Gasoline</option><option>Hybrid</option><option>Electric</option><option>Diesel</option></select></div>
      <div className="field"><label>Earliest model year</label><input className="input" type="number" value={form.yearMin} onChange={(event) => set('yearMin', event.target.value)} min="2000" max="2027" /></div>
      <div className="field"><label>Latest model year</label><input className="input" type="number" value={form.yearMax} onChange={(event) => set('yearMax', event.target.value)} min="2000" max="2027" /></div>
      <div className="field"><label>Trim <span className="muted">(optional)</span></label><input className="input" value={form.trim} onChange={(event) => set('trim', event.target.value)} placeholder="e.g. Outer Banks" /></div>
      <div className="field"><label>Drivetrain <span className="muted">(optional)</span></label><select className="select" value={form.drivetrain} onChange={(event) => set('drivetrain', event.target.value)}><option value="">No preference</option><option>FWD</option><option>RWD</option><option>AWD</option><option>4WD</option></select></div>
      <div className="field"><label>Transmission <span className="muted">(optional)</span></label><select className="select" value={form.transmission} onChange={(event) => set('transmission', event.target.value)}><option value="">No preference</option><option>Automatic</option><option>Manual</option></select></div>
      <div className="field"><label>Exterior colour <span className="muted">(optional)</span></label><input className="input" value={form.color} onChange={(event) => set('color', event.target.value)} placeholder="Any colour" /></div>
      <div className="field"><label>Search area</label><input className="input" value={form.area} onChange={(event) => set('area', event.target.value)} required /></div>
      <div className="field"><label>State</label><select className="select" value={form.state} onChange={(event) => set('state', event.target.value)}>{states.map((state) => <option key={state}>{state}</option>)}</select></div>
      <div className="field"><label>Dealer radius</label><select className="select" value={form.radius} onChange={(event) => set('radius', event.target.value)}><option value="25">Within 25 miles</option><option value="50">Within 50 miles</option><option value="100">Within 100 miles</option><option value="250">Within 250 miles</option></select></div>
      <div className="field"><label>When are you planning to decide?</label><select className="select" value={form.timeline} onChange={(event) => set('timeline', event.target.value)}>{timelineOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small className="field-hint">{timeline.help}</small></div>
      <div className="field form-span"><label>Anything else dealers should know? <span className="muted">(optional)</span></label><textarea className="textarea" value={form.details} onChange={(event) => set('details', event.target.value)} placeholder="Must-have equipment, accessibility needs, preferred delivery timing…" rows={4} /></div>
      <div className="form-span request-form-actions"><Link className="button button-secondary" to="/chatbot?prompt=request"><Sparkles size={17} /> Build with Serra</Link><button className="button button-primary">Review private brief <ArrowRight size={17} /></button></div>
    </form></section> : <div className="detail-grid"><section className="card card-pad request-review"><span className="eyebrow">Dealer-facing brief</span><h2>{form.brand} {form.model}</h2><div className="request-review-location"><MapPin size={18} /><span><strong>{form.area}, {form.state}</strong><small>Dealers within {form.radius} miles</small></span></div><div className="spec-list"><div className="spec"><span>Model years</span><strong>{form.yearMin}–{form.yearMax}</strong></div><div className="spec"><span>Body / fuel</span><strong>{[form.bodyType, form.fuel].filter(Boolean).join(' · ') || 'No preference'}</strong></div><div className="spec"><span>Timing</span><strong>{timeline.label}</strong></div><div className="spec"><span>Preferences</span><strong>{[form.trim, form.drivetrain, form.transmission, form.color].filter(Boolean).join(' · ') || 'Open to options'}</strong></div><div className="spec"><span>Additional notes</span><strong>{form.details || 'Nothing else added'}</strong></div></div><div className="request-form-actions"><button className="button button-secondary" onClick={() => setStep(1)}><ArrowLeft size={17} /> Edit brief</button><button className="button button-primary" onClick={publish}><CheckCircle2 size={17} /> Publish to verified dealers</button></div></section><aside className="card card-pad privacy-card"><div className="privacy-icon"><ShieldCheck /></div><span className="eyebrow">Privacy gate</span><h3>What stays hidden</h3><p>Your name, email, phone number, exact address, and AI-inferred budget are never shown in this brief.</p><p>Contact opens only after you accept an offer or a dealer accepts your negotiation request.</p></aside></div>}
  </div>;
}
