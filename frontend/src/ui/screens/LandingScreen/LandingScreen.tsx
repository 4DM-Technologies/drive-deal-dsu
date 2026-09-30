import { ArrowRight, BadgeCheck, CarFront, Check, Handshake, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { ScrollControls } from '@/ui/reusables/ScrollControls/ScrollControls';

const steps = [
  { icon: CarFront, title: 'Describe your ideal car', body: 'Share the model, budget, timing, location, and the features that matter. You can edit everything before it goes live.' },
  { icon: Handshake, title: 'Verified dealers compete', body: 'Nearby dealers respond with an itemized out-the-door offer. No surprise math and no hidden ranking boosts.' },
  { icon: BadgeCheck, title: 'Choose with confidence', body: 'Compare like for like, ask Serra for help, open a conversation, and accept only when the offer feels right.' },
];

export default function LandingScreen() {
  return (
    <div>
      <section className="hero">
        <img className="hero-image" src={heroImage} alt="Deep blue sedan on a warm modern forecourt at sunset" fetchPriority="high" />
        <div className="hero-top"><div className="shell public-nav"><Link to="/"><Brand /></Link><div className="public-nav-links"><a className="nav-link" href="#how">How it works</a><Link className="nav-link dealer-entry" to="/login?role=dealer">Dealer sign in</Link><Link className="button button-secondary public-login" to="/login">Log in</Link><Link className="button button-primary" to="/signup/buyer">Start buying <ArrowRight size={17} /></Link></div></div></div>
        <div className="shell">
          <div className="hero-content">
            <span className="eyebrow">The reverse car marketplace</span>
            <h1>Your car.<br />Their best offer.</h1>
            <p>Stop chasing listings. Tell verified dealers what you want and let clear, itemized offers come to you.</p>
            <div className="hero-actions"><Link className="button button-primary" to="/signup/buyer">Create a buyer request <ArrowRight size={18} /></Link><Link className="button button-secondary" to="/signup/dealer">I represent a dealership</Link></div>
            <div className="hero-trust"><span><ShieldCheck size={16} /> Verified dealer network</span><span><Check size={16} /> Itemized pricing</span><span><Sparkles size={16} /> Buyer-side AI guidance</span></div>
          </div>
        </div>
      </section>
      <section className="section" id="how"><div className="shell"><Reveal><div className="section-head"><div><span className="eyebrow">A calmer way to buy</span><h2>Demand leads.<br />Dealers respond.</h2></div><p>DriveDeal shifts the work to the seller side while keeping identity and contact protected until you decide to open the door.</p></div></Reveal><div className="grid grid-3">{steps.map(({ icon: Icon, title, body }, index) => <Reveal key={title} delay={index * .07}><article className="card how-card"><div className="step-number"><Icon size={20} /></div><span className="eyebrow">Step {index + 1}</span><h3>{title}</h3><p>{body}</p></article></Reveal>)}</div></div></section>
      <section className="section surface-section"><div className="shell"><Reveal><div className="card" style={{ padding: 'clamp(1.5rem,5vw,4rem)', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2rem', alignItems: 'center' }}><div><span className="eyebrow">Ready when you are</span><h2 style={{ fontSize: 'clamp(2rem,4vw,3.8rem)', margin: '.55rem 0 .7rem' }}>Make dealers compete for your business.</h2><p className="muted" style={{ maxWidth: 650 }}>A request takes a few minutes. Serra can help you work out the details without publishing anything until you approve it.</p></div><Link className="button button-primary" to="/signup/buyer">Build my request <ArrowRight size={18} /></Link></div></Reveal></div></section>
      <footer className="public-footer"><div className="shell"><span>© 2026 DriveDeal. Built for confident car buying.</span><span><Link to="/login?role=dealer">Dealer portal</Link> · <Link to="/login?role=support">Team access</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></span></div></footer>
      <ScrollControls />
    </div>
  );
}
