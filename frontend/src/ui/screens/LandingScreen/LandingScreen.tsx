import { ArrowRight, BadgeCheck, BellRing, Check, Handshake, Plus, Send, ShieldCheck, Sparkles, Trophy, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
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

const faqs = [
  { question: 'Is Deal&Drive free for buyers?', answer: 'Yes, it is free for buyers. Posting a request, receiving quotes, comparing offers, negotiating, and working with Serra never cost you anything. Dealers pay only when a deal closes, so they are rewarded for winning your business with a competitive offer, not for chasing you.' },
  { question: 'What does “out-the-door” actually include?', answer: 'Every quote is itemized and covers the vehicle price, sales tax, title, license, and the dealer’s doc fee. That total is what you would actually pay to drive the car away, so nothing surprising gets added later. Quotes are ranked by this final number, which keeps every comparison like for like.' },
  { question: 'How anonymous am I, really?', answer: 'Dealers see the car you want, your target price, and how far you will travel. They never see your name, phone number, or email. Your details stay hidden while quotes arrive and while you negotiate in-platform, and they are shared only once you accept a quote, so you decide who hears from you.' },
  { question: 'Can I include a trade-in or financing?', answer: 'Yes. Add your trade-in details or your financing preference when you build your request, and dealers will factor them into their quote. Instead of juggling separate numbers for the car, the trade, and the loan, you get one final figure from each dealer that you can compare side by side.' },
  { question: 'What is Serra?', answer: 'Serra is our AI advisor. Describe the car you want in plain language and Serra builds your request for you, including make, model, trim, color, target price, and travel distance. Nothing is sent to dealers until you review it and give your OK, and Serra can also help you compare quotes once they come in.' },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="section faq-section" id="faq">
      <div className="shell">
        <Reveal>
          <div className="faq-head">
            <h2>FAQ</h2>
            <p>Straight answers about pricing, privacy, and how Deal&amp;Drive works.</p>
          </div>
        </Reveal>
        <Reveal delay={.06}>
          <div className="faq-list">
            {faqs.map(({ question, answer }, index) => {
              const isOpen = open === index;
              return (
                <div key={question} className={`faq-item${isOpen ? ' open' : ''}`}>
                  <h3>
                    <button type="button" className="faq-question" id={`faq-q-${index}`} aria-expanded={isOpen} aria-controls={`faq-a-${index}`} onClick={() => setOpen(isOpen ? null : index)}>
                      <span className="faq-num">{String(index + 1).padStart(2, '0')}</span>
                      <span className="faq-text">{question}</span>
                      <Plus className="faq-icon" size={22} aria-hidden="true" />
                    </button>
                  </h3>
                  <div className="faq-answer" id={`faq-a-${index}`} role="region" aria-labelledby={`faq-q-${index}`}>
                    <div className="faq-answer-inner"><p>{answer}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default function LandingScreen() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div>
      <header className={`public-header${scrolled ? ' is-scrolled' : ''}`}><div className="shell public-nav"><Link to="/"><Brand /></Link><nav className="public-nav-links" aria-label="Sections"><a className="nav-link" href="#how">How it works</a><a className="nav-link" href="#why">Why choose us</a><a className="nav-link" href="#dealers">For dealers</a><Link className="nav-link dealer-entry" to="/login?role=dealer">Dealer sign in</Link></nav><div className="public-nav-actions"><Link className="button button-secondary public-login" to="/login">Log in</Link><Link className="button button-primary" to="/signup/buyer">Start buying <ArrowRight size={17} /></Link></div></div></header>
      <section className="hero">
        <img className="hero-image" src={heroImage} alt="Deep blue sedan on a warm modern forecourt at sunset" fetchPriority="high" />
        <div className="shell">
          <div className="hero-content">
            <span className="eyebrow">Dealers compete. You decide.</span>
            <h1>Your car.<br />Their best offer.</h1>
            <p>Stop chasing listings. Tell verified dealers what you want and let clear, itemized offers come to you.</p>
            <div className="hero-actions"><Link className="button button-primary" to="/signup/buyer">Create a buyer request <ArrowRight size={18} /></Link><Link className="button button-secondary" to="/signup/dealer">I represent a dealership</Link></div>
            <div className="hero-trust"><span><ShieldCheck size={16} /> Verified dealer network</span><span><Check size={16} /> Itemized pricing</span><span><Sparkles size={16} /> Buyer-side AI guidance</span></div>
          </div>
        </div>
      </section>
      <section className="section" id="how"><div className="shell"><Reveal><div className="section-head"><div><span className="eyebrow">How it works</span><h2>Four steps. One winner.</h2></div><p>From posting to picking, everything happens in one place—no showroom marathon and no phone tag.</p></div></Reveal><div className="how-journey">{steps.map(({ owner, icon: Icon, title, body }, index) => <Reveal key={title} className="how-item" delay={index * .06}><article className="card how-card"><div className="how-card-top"><span className="step-owner">{owner}</span><span className="step-number">{index + 1}</span></div><div className="how-icon"><Icon size={20} /></div><h3>{title}</h3><p>{body}</p></article></Reveal>)}</div></div></section>
      <section className="section difference-section" id="why"><div className="shell difference-grid"><Reveal className="difference-item"><article className="difference-copy"><span className="eyebrow">Our difference</span><h2>Why choose us</h2><p>Deal&amp;Drive is free for customers, with AI guidance that makes buying simpler and smarter. Dealers compete on your terms, every quote is itemized, and the price you compare includes tax, title, licence, and fees.</p><div className="difference-points"><span><BadgeCheck /> Complete out-the-door totals</span><span><ShieldCheck /> Private until you choose</span><span><Sparkles /> Buyer-side AI guidance</span></div></article></Reveal><Reveal className="difference-item" delay={.08}><article className="card dealer-callout" id="dealers"><div className="dealer-callout-head"><div className="dealer-callout-icon"><UserRound /></div><span className="eyebrow">For dealers</span></div><h2>Serious buyers. Zero cold leads.</h2><p>Every request is a real person who shared the exact car, location, and timeframe. Quote once, compete transparently, and win business your BDC never had to chase.</p><Link className="button button-primary" to="/signup/dealer">Join as a dealer <ArrowRight size={17} /></Link></article></Reveal></div></section>
      <section className="section surface-section"><div className="shell"><Reveal><div className="card cta-card"><div><span className="eyebrow">Ready when you are</span><h2>Make dealers compete for your business.</h2><p className="muted">Tell us the car you want, your target out-the-door price, and how far you will travel. Verified dealers near you send itemized quotes covering vehicle, tax, title, licence, and fees, so you compare real totals instead of teaser prices. A request takes only a few minutes, and Serra can help you work out the details without publishing anything until you approve it.</p><div className="difference-points"><span><BadgeCheck /> Free for buyers</span><span><ShieldCheck /> Details private until you choose</span><span><Sparkles /> Nothing published without your OK</span></div></div><Link className="button button-primary" to="/signup/buyer">Build my request <ArrowRight size={18} /></Link></div></Reveal></div></section>
      <FaqSection />
      <footer className="public-footer"><div className="shell"><span>© 2026 Deal&amp;Drive. Built for confident car buying.</span><span><Link to="/login?role=dealer">Dealer portal</Link> · <Link to="/login?role=support">Team access</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></span></div></footer>
    </div>
  );
}
