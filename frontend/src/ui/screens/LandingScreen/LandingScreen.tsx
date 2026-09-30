import { ArrowRight, BadgeCheck, BellRing, Check, Handshake, Send, ShieldCheck, Sparkles, Trophy, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { Brand } from '@/ui/reusables/Brand/Brand';

const steps = [
  { owner: 'You', icon: Send, title: 'Post your request', body: 'Share make, model, trim, color, target out-the-door price, and how far you will travel—or let Serra build it from a conversation.' },
  { owner: 'We', icon: BellRing, title: 'Matching dealers are notified', body: 'Dealers inside your radius who can deliver the car see the request. Your name and contact details stay hidden.' },
  { owner: 'Dealers', icon: Handshake, title: 'Quotes come to you', body: 'Each dealer submits an itemized out-the-door quote covering vehicle, tax, title, licence, and fees.' },
  { owner: 'You', icon: Trophy, title: 'Compare, negotiate, accept', body: 'Quotes are ranked by final price. Compare with Serra, negotiate in-platform, and accept the offer you prefer.' },
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
      <section className="section" id="how"><div className="shell"><Reveal><div className="section-head"><div><span className="eyebrow">How it works</span><h2>Four steps. One winner.</h2></div><p>From posting to picking, everything happens in one place—no showroom marathon and no phone tag.</p></div></Reveal><div className="how-journey">{steps.map(({ owner, icon: Icon, title, body }, index) => <Reveal key={title} delay={index * .06}><article className="card how-card"><div className="how-card-top"><span className="step-owner">{owner}</span><span className="step-number">{index + 1}</span></div><div className="how-icon"><Icon size={20} /></div><h3>{title}</h3><p>{body}</p></article></Reveal>)}</div></div></section>
      <section className="section difference-section"><div className="shell difference-grid"><Reveal><article className="difference-copy"><span className="eyebrow">Our difference</span><h2>Why choose us</h2><p>Deal&amp;Drive is free for customers, with AI guidance that makes buying simpler and smarter. Dealers compete on your terms, every quote is itemized, and the price you compare includes tax, title, licence, and fees.</p><div className="difference-points"><span><BadgeCheck /> Complete out-the-door totals</span><span><ShieldCheck /> Private until you choose</span><span><Sparkles /> Buyer-side AI guidance</span></div></article></Reveal><Reveal delay={.08}><article className="card dealer-callout"><div className="dealer-callout-icon"><UserRound /></div><span className="eyebrow">For dealers</span><h2>Serious buyers. Zero cold leads.</h2><p>Every request is a real person who shared the exact car, location, and timeframe. Quote once, compete transparently, and win business your BDC never had to chase.</p><Link className="button button-primary" to="/signup/dealer">Join as a dealer <ArrowRight size={17} /></Link></article></Reveal></div></section>
      <section className="section surface-section"><div className="shell"><Reveal><div className="card" style={{ padding: 'clamp(1.5rem,5vw,4rem)', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2rem', alignItems: 'center' }}><div><span className="eyebrow">Ready when you are</span><h2 style={{ fontSize: 'clamp(2rem,4vw,3.8rem)', margin: '.55rem 0 .7rem' }}>Make dealers compete for your business.</h2><p className="muted" style={{ maxWidth: 650 }}>A request takes a few minutes. Serra can help you work out the details without publishing anything until you approve it.</p></div><Link className="button button-primary" to="/signup/buyer">Build my request <ArrowRight size={18} /></Link></div></Reveal></div></section>
      <footer className="public-footer"><div className="shell"><span>© 2026 Deal&amp;Drive. Built for confident car buying.</span><span><Link to="/login?role=dealer">Dealer portal</Link> · <Link to="/login?role=support">Team access</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></span></div></footer>
    </div>
  );
}
