import { ArrowDown, ArrowRight, BadgeCheck, Check, ChevronDown, Menu, ShieldCheck, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';
import heroImage from '@/assets/vehicles/campaign-coupe.webp';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { buyerFaqs, dealerFaqs, buyerHero, dealerHero, buyerProcess, dealerProcess, buyerFeatures, dealerFeatures, buyerJourney, dealerStart, oldWay, newWay, seraPoints } from './content';
import interiorImage from '@/assets/vehicles/campaign-interior.webp';
import dealerImage from '@/assets/vehicles/campaign-suv.webp';
import { useScrollTopOnPush } from '@/helpers/useScrollTopOnPush';
import './Campaign.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function Campaign({ dealer = false }: { dealer?: boolean }) {
  useScrollTopOnPush();
  const root = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const signup = dealer ? '/signup/dealer' : '/signup/buyer';
  const faqs = dealer ? dealerFaqs : buyerFaqs;
  const heroCopy = dealer ? dealerHero : buyerHero;
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.timeline({ defaults: { ease: 'power3.out', duration: .9 } })
        .from('.campaign-headline > span', { y: 40, opacity: 0, stagger: .12 })
        .from('.campaign-intro', { y: 16, opacity: 0 }, '-=.55')
        .from('.campaign-hero-actions', { y: 12, opacity: 0 }, '-=.5');
      gsap.utils.toArray<HTMLElement>('[data-campaign-reveal]', root.current).forEach((section) => {
        gsap.from(section, { y: 24, opacity: 0, duration: .65, scrollTrigger: { trigger: section, start: 'top 93%', once: true } });
      });
    });
    media.add('(min-width: 1024px) and (prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.campaign-hero-image', { y: 0 }, { y: 65, ease: 'none', scrollTrigger: { trigger: '.campaign-hero', start: 'top top', end: 'bottom top', scrub: .5 } });
    });
    return () => media.revert();
  }, { scope: root });

  const process = dealer ? dealerProcess : buyerProcess;

  return <div className={`campaign ${dealer ? 'campaign-dealer' : ''}`} ref={root}>
    <a className="skip-link" href="#campaign-main">Skip to content</a>
    <header className="campaign-header"><div className="campaign-container campaign-nav">
      <Link to="/" aria-label="Deal&Drive home"><Brand /></Link>
      <nav className="campaign-desktop-nav" aria-label="Main navigation"><a href="#how">How it works</a><a href="#why">{dealer ? 'Why dealers' : 'Why choose us'}</a><Link to={dealer ? '/' : '/dealers'}>{dealer ? 'For customers' : 'For dealers'}</Link></nav>
      <div className="campaign-nav-actions"><Link className="campaign-signin" to={dealer ? '/login?role=dealer' : '/login'}>{dealer ? 'Dealer sign in' : 'Log in'} <ArrowRight size={15} /></Link><button type="button" className="campaign-menu" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="campaign-mobile-nav" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X /> : <Menu />}</button></div>
    </div>{menuOpen && <nav id="campaign-mobile-nav" className="campaign-mobile-nav" aria-label="Mobile navigation"><a href="#how" onClick={() => setMenuOpen(false)}>How it works</a><a href="#why" onClick={() => setMenuOpen(false)}>The difference</a><Link to={dealer ? '/' : '/dealers'}>{dealer ? 'For buyers' : 'For dealers'}</Link><Link to={signup}>{dealer ? 'Join the network' : 'Start your request'}</Link></nav>}</header>
    <main id="campaign-main" tabIndex={-1}>
      <section className="campaign-hero">
        <img className="campaign-hero-image" src={dealer ? dealerImage : heroImage} width={1774} height={887} alt="" fetchPriority="high" />
        <div className="campaign-hero-wash" />
        <div className="campaign-container campaign-hero-copy">
          <p className="campaign-kicker">{dealer ? 'For dealerships' : 'Dealers compete. You decide.'}</p>
          <h1 className={`campaign-headline ${dealer ? 'campaign-headline-dealer' : ''}`}><span>{heroCopy[0]}</span><span>{heroCopy[1]}</span></h1>
          <p className="campaign-intro">{heroCopy[2]}</p>
          <div className="campaign-hero-actions"><Link className="button button-primary" to={signup}>{dealer ? 'Join as a dealer' : 'Create a buyer request'} <ArrowRight size={19} /></Link>{dealer ? <a className="campaign-text-link" href="#how">See how it works <ArrowDown size={17} /></a> : <Link className="campaign-text-link" to="/signup/dealer">I represent a dealership <ArrowRight size={17} /></Link>}</div>
        </div>
        <div className="campaign-hero-bottom campaign-container"><span>{dealer ? 'Built for dealers who deliver.' : 'Dealers compete. You decide.'}</span><a href="#how" aria-label="Explore how Deal&Drive works"><ArrowDown size={20} /></a></div>
      </section>
      <div className="campaign-assurance"><div className="campaign-container"><span><ShieldCheck size={18} /> Verified dealerships</span><span><BadgeCheck size={18} /> Complete pricing</span><span><Check size={18} /> {dealer ? 'Real buyer demand' : 'Buyer-controlled contact'}</span></div></div>
      <section className="campaign-section campaign-container campaign-process" id="how">
        <div className="campaign-section-heading" data-campaign-reveal><span className="eyebrow">How it works</span><h2>{dealer ? 'Four Steps. Zero Floor Hours.' : 'Four steps. One winner.'}</h2><p>{dealer ? 'From a buyer’s request to a closed deal, everything happens on one dashboard—no phone tag and no showroom marathons.' : 'From posting to picking, everything happens in one place—no showroom marathon and no phone tag.'}</p></div>
        <ol className="campaign-process-list">{process.map(([title, text], index) => <li key={title} data-campaign-reveal><span className="campaign-step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{text}</p></div><ArrowRight size={21} aria-hidden="true" /></li>)}</ol>
      </section>
      <section className="campaign-story" id="why"><div className="campaign-container campaign-story-grid">
        <div className="campaign-story-image" data-campaign-reveal><img src={interiorImage} width={1536} height={1024} loading="lazy" alt="Decorative luxury automotive cockpit with graphite leather and brushed metal" /></div>
        <div className="campaign-story-copy" data-campaign-reveal><span className="eyebrow">{dealer ? 'Why dealers join' : 'Meet Sera'}</span><h2>{dealer ? 'Built for dealers who’d rather sell than chase.' : 'Describe your dream car. Sera builds the request.'}</h2><p>{dealer ? 'Every part of the platform exists to cut the busywork between a serious buyer and your signature.' : 'Chat in plain language. Sera asks the right questions, then drafts a complete request for you to review. Nothing goes out until you say so.'}</p>{!dealer && <ul>{seraPoints.map((point) => <li key={point}><Check size={17} />{point}</li>)}</ul>}<Link className="campaign-text-link" to={signup}>{dealer ? 'Join as a dealer' : 'Start with Sera'} <ArrowRight size={18} /></Link></div>
      </div></section>
      <section className="campaign-container campaign-section campaign-feature-section"><div className="campaign-feature-heading" data-campaign-reveal><span className="eyebrow">{dealer ? 'Why dealers join' : 'Buyer benefits'}</span><h2>{dealer ? 'Built for dealers who’d rather sell than chase.' : 'Everything on your side of the table.'}</h2><p>{dealer ? 'Every part of the platform exists to cut the busywork between a serious buyer and your signature.' : 'Every feature exists to give the buyer clarity, leverage and peace of mind.'}</p></div><div className="campaign-feature-grid">{(dealer ? dealerFeatures : buyerFeatures).map(([title, body]) => <article key={title} data-campaign-reveal><BadgeCheck size={22} aria-hidden="true" /><h3>{title}</h3><p>{body}</p></article>)}</div></section>
      {!dealer && <section className="campaign-story"><div className="campaign-container campaign-story-grid"><div className="campaign-story-copy" data-campaign-reveal><span className="eyebrow">Compare like for like</span><h2>The sticker price isn’t the price.</h2><p>Teaser prices leave out tax, title, licence and fees. Deal&amp;Drive ranks every offer by what you’ll actually pay to drive away, so the cheapest quote really is the cheapest.</p><strong>Every quote itemizes</strong><ul>{['Vehicle price', 'Sales tax', 'Title & licence', 'Dealer doc fee', 'Trade-in credit'].map((item) => <li key={item}><Check size={17} />{item}</li>)}</ul><Link className="button button-primary" to={signup}>Build my request <ArrowRight size={18} /></Link></div><div className="campaign-story-image" data-campaign-reveal><img src={dealerImage} width={1536} height={1024} alt="Decorative performance SUV outside a contemporary showroom" loading="lazy" /></div></div></section>}
      {dealer && <section className="campaign-container campaign-section"><div data-campaign-reveal><span className="eyebrow">The difference</span><h2>Stop working leads. Start winning deals.</h2><p>See what changes when buyers arrive with the exact car already chosen.</p></div><div className="campaign-versus"><article><span className="eyebrow">The old way</span><h3>Chasing leads on the floor</h3><ul>{oldWay.map((item) => <li key={item}><X size={16} />{item}</li>)}</ul></article><article><span className="eyebrow">With Deal&amp;Drive</span><h3>Quoting buyers who are ready</h3><ul>{newWay.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul></article></div></section>}
      <section className="campaign-container campaign-section campaign-journey"><div data-campaign-reveal><span className="eyebrow">{dealer ? 'Get started' : 'Your buying journey'}</span><h2>{dealer ? 'Live on the platform in three steps.' : 'From request to keys, every step visible.'}</h2><p>{dealer ? 'Apply once, get verified, and start answering buyers who are ready to commit.' : 'Post once, pick your offer, chat with your dealer, meet in person, and close the deal, with every stage tracked along the way.'}</p></div><ol>{(dealer ? dealerStart : buyerJourney).map(([title, body]) => <li key={title} data-campaign-reveal><h3>{title}</h3><p>{body}</p></li>)}</ol></section>
      {!dealer && <section className="campaign-container campaign-section campaign-difference"><article data-campaign-reveal><span className="eyebrow">Our difference</span><h2>Why choose us</h2><p>Deal&amp;Drive is free for customers, with AI guidance that makes buying simpler and smarter. Dealers compete on your terms, every quote is itemized, and the price you compare includes tax, title, licence, and fees.</p><ul><li><BadgeCheck size={18} />Complete out-the-door totals</li><li><ShieldCheck size={18} />Private until you choose</li><li><Check size={18} />Buyer-side AI guidance</li></ul></article><article data-campaign-reveal><span className="eyebrow">For dealers</span><h2>Serious buyers. Zero cold leads.</h2><p>Every request is a real person who shared the exact car, location, and timeframe. Quote once, compete transparently, and win business your BDC never had to chase.</p><div className="campaign-hero-actions"><Link className="button button-primary" to="/signup/dealer">Join as a dealer <ArrowRight size={18} /></Link><Link className="campaign-text-link" to="/dealers">More info <ArrowRight size={18} /></Link></div></article></section>}
      {dealer && <section className="campaign-container campaign-section campaign-membership" data-campaign-reveal><div><span className="eyebrow">Dealer membership</span><h2>YOUR NEXT CHAPTER<br />STARTS HERE.</h2><p>Start free for 2 months with up to 3 quotes. Upgrade when you’re ready to keep quoting.</p></div><div className="campaign-price"><span>Dealer Premium</span><strong>$500<span> / year</span></strong><p>Unlimited quotes. One payment for a full year.</p><Link className="button button-primary" to={signup}>Apply for membership <ArrowRight size={18} /></Link></div></section>}
      <section className="campaign-container campaign-section campaign-faq" id="faq"><div data-campaign-reveal><span className="eyebrow">{dealer ? 'Dealer FAQ' : 'FAQ'}</span><h2>{dealer ? 'Dealer FAQ' : 'FAQ'}</h2><p>{dealer ? 'Straight answers about pricing, privacy, and how quoting works.' : 'Straight answers about pricing, privacy, and how Deal&Drive works.'}</p></div><div className="campaign-faq-list">{faqs.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="campaign-closing"><div className="campaign-container" data-campaign-reveal><span className="eyebrow">Ready when you are</span><h2>{dealer ? 'Your next buyer has already picked the car. All that’s left is your number.' : 'Make dealers compete for your business.'}</h2><p>{dealer ? 'Apply in minutes. Once you’re approved, requests that match your inventory start landing on your dashboard.' : 'Tell us the car you want, your target out-the-door price, and how far you will travel. Verified dealers near you send itemized quotes covering vehicle, tax, title, licence, and fees, so you compare real totals instead of teaser prices. A request takes only a few minutes, and Sera can help you work out the details without publishing anything until you approve it.'}</p><Link className="button button-primary" to={signup}>{dealer ? 'Join as a dealer' : 'Build my request'} <ArrowRight size={20} /></Link></div></section>
    </main>
    <footer className="campaign-footer campaign-container"><div><Link to="/"><Brand /></Link><p>Built for confident car buying.</p></div><nav aria-label="Footer navigation"><Link to="/dealers">For dealers</Link><Link to="/login?role=dealer">Dealer portal</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/login?role=support">Team access</Link></nav><small>© 2026 Deal&amp;Drive. Built for confident car buying.</small></footer>
  </div>;
}


