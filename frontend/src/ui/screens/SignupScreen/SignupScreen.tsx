import { ArrowRight, Building2, CheckCircle2, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { brands, states } from '@/services/mocks/fixtures';
import { useDemoStore } from '@/services/platform/demoStore';
import { Brand } from '@/ui/reusables/Brand/Brand';

export function SignupChooser() {
  return (
    <main className="auth-panel signup-chooser">
      <div className="auth-card signup-card">
        <Link to="/"><Brand /></Link>
        <span className="eyebrow">Create your account</span>
        <h1>Choose your DriveDeal workspace</h1>
        <p className="muted">Buyer and dealer accounts have different tools, so each gets a purpose-built experience.</p>
        <div className="grid grid-2 signup-choices">
          <Link className="card card-pad card-hover signup-choice" to="/signup/buyer"><div className="step-number"><UserRound /></div><h2>I want to buy a car</h2><p className="muted">Post one clear request, compare dealer offers, and choose without pressure.</p><span>Create buyer account <ArrowRight size={16} /></span></Link>
          <Link className="card card-pad card-hover signup-choice" to="/signup/dealer"><div className="step-number"><Building2 /></div><h2>I represent a dealership</h2><p className="muted">Meet high-intent buyers and respond with transparent, itemized quotes.</p><span>Apply as a dealer <ArrowRight size={16} /></span></Link>
        </div>
        <p className="auth-alternate">Already have an account? <Link to="/login">Sign in</Link></p>
      </div>
    </main>
  );
}

export default function SignupScreen() {
  const { role = 'buyer' } = useParams();
  const type = role === 'support' ? 'support' : role === 'dealer' ? 'dealer' : 'buyer';
  const loginAs = useDemoStore((state) => state.loginAs);
  const navigate = useNavigate();
  const [terms, setTerms] = useState(false);
  const [complete, setComplete] = useState(false);
  const pending = type !== 'buyer';

  if (complete) return <main className="auth-panel signup-chooser"><div className="auth-card card card-pad signup-complete"><div className="empty-icon success-icon"><CheckCircle2 /></div><h1>{pending ? `Your ${type} account is pending approval.` : 'Your buyer account is ready.'}</h1><p className="muted">{pending ? 'Our team reviews every request. You will receive an email when access is approved.' : 'Create your first vehicle request and start receiving dealer offers.'}</p><button className="button button-primary" onClick={() => pending ? navigate(`/login?role=${type}`) : (loginAs('buyer'), navigate('/home'))}>{pending ? 'Back to sign in' : 'Open my dashboard'} <ArrowRight size={17} /></button></div></main>;

  return (
    <main className="auth-page">
      <section className="auth-art"><img src={heroImage} alt="Blue sedan on an open road" /><div className="auth-art-copy"><span className="eyebrow auth-eyebrow">{type === 'buyer' ? 'Your next car starts here' : type === 'dealer' ? 'Turn demand into deals' : 'Protected operational access'}</span><h2>{type === 'buyer' ? 'Describe the car. Let the right offer find you.' : type === 'dealer' ? 'Meet buyers already ready to decide.' : 'Support access is reviewed by a person.'}</h2></div></section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-brand-row"><Link to="/"><Brand /></Link></div>
          <div className="auth-title"><span className="eyebrow">{type === 'buyer' ? 'Buyer account' : type === 'dealer' ? 'Dealer application' : 'Team access request'}</span><h1>{type === 'buyer' ? 'Create your buyer account' : type === 'dealer' ? 'Register your dealership' : 'Request support access'}</h1><p className="muted">Required information keeps the marketplace trustworthy. You can review everything before submitting.</p></div>
          <form className="form-grid signup-form" onSubmit={(event) => { event.preventDefault(); if (terms) setComplete(true); }}>
            <div className="field"><label>Full name</label><input className="input" autoComplete="name" required /></div>
            <div className="field"><label>Email address</label><input className="input" type="email" autoComplete="email" required /></div>
            <div className="field"><label>Phone number</label><input className="input" type="tel" autoComplete="tel" pattern="^\+?[0-9 ()-]{7,18}$" required /></div>
            <div className="field"><label>Create password</label><input className="input" type="password" autoComplete="new-password" minLength={8} required /></div>
            {type === 'dealer' && <><div className="field"><label>Dealership name</label><input className="input" required /></div><div className="field"><label>Branch name</label><input className="input" required /></div><div className="field"><label>Dealer licence number</label><input className="input" required /></div><div className="field"><label>Website</label><input className="input" type="url" required /></div><div className="field"><label>State</label><select className="select" required defaultValue="Texas">{states.map((state) => <option key={state}>{state}</option>)}</select></div><div className="field"><label>Primary brand</label><select className="select" required defaultValue="Ford">{brands.map((brand) => <option key={brand}>{brand}</option>)}</select></div><div className="field form-span"><label>Business address</label><input className="input" required /></div></>}
            {type === 'support' && <><div className="field form-span"><label>Location address</label><input className="input" required /></div><div className="field"><label>State</label><select className="select" required defaultValue="Texas">{states.map((state) => <option key={state}>{state}</option>)}</select></div><div className="field form-span"><label>Verification note <span className="muted">(optional)</span></label><textarea className="textarea" rows={3} placeholder="Add anything that helps us verify your request" /></div></>}
            <label className="checkbox-row form-span"><input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} required /><span>I agree to DriveDeal’s <Link to="/terms" target="_blank">Terms of Service</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>.</span></label>
            <button className="button button-primary form-span" disabled={!terms}>{type === 'buyer' ? 'Create buyer account' : 'Submit for review'} <ArrowRight size={17} /></button>
          </form>
          <p className="auth-alternate auth-alternate-bottom">Already registered? <Link to={`/login?role=${type}`}>Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
