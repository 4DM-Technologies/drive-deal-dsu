import { motion, useReducedMotion, useScroll, useSpring } from 'motion/react';
import {
  ArrowRight,
  BadgeCheck,
  Car,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  LockKeyhole,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import buyerInspectionImage from '@/assets/dealdrive-buyer-inspection.png';
import graphiteSuvImage from '@/assets/dealdrive-graphite-suv.png';
import { formatMoney } from '@/helpers/currency';
import { useScrollTopOnPush } from '@/helpers/useScrollTopOnPush';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import './LandingScreen.css';

const offers = [
  { name: 'Northgate Auto', vehicle: 34_400, tax: 2_150, title: 350, fee: 1_450 },
  { name: 'Lakeshore Motors', vehicle: 35_000, tax: 2_188, title: 225, fee: 650 },
  { name: 'Premier Cars', vehicle: 35_300, tax: 2_206, title: 203, fee: 150 },
].map((offer) => ({ ...offer, total: offer.vehicle + offer.tax + offer.title + offer.fee }));

const faqs = [
  {
    question: 'Is Deal&Drive free for buyers?',
    answer: 'Yes. Creating a request, comparing quotes, negotiating, and using Sera are free for buyers. Dealers pay only after a completed deal.',
  },
  {
    question: 'What is included in an out-the-door price?',
    answer: 'Each quote separates the vehicle price, sales tax, title and registration, dealer documentation fee, and any trade-in credit.',
  },
  {
    question: 'When do dealers see my contact details?',
    answer: 'Your name, phone number, and email stay private while offers arrive. Contact details unlock only after you accept an offer or open an approved negotiation.',
  },
  {
    question: 'Can I negotiate an offer?',
    answer: 'Yes. You can message a dealer inside Deal&Drive. Revised offers are itemized again and automatically re-ranked by their final total.',
  },
  {
    question: 'How are dealers verified?',
    answer: 'Dealers provide their dealership information and licence details. Our support team reviews the application before the dealership can view requests or quote.',
  },
];

function OfferComparison() {
  const [showTotal, setShowTotal] = useState(true);
  const sorted = [...offers].sort((a, b) => (showTotal ? a.total - b.total : a.vehicle - b.vehicle));

  return (
    <div className="dd-offer-demo" aria-label="Example dealer offer comparison">
      <div className="dd-offer-head">
        <div>
          <span>2026 midsize sedan</span>
          <strong>Three verified offers</strong>
        </div>
        <div className="dd-price-toggle" role="group" aria-label="Displayed price">
          <button type="button" className={!showTotal ? 'is-active' : ''} aria-pressed={!showTotal} onClick={() => setShowTotal(false)}>Vehicle</button>
          <button type="button" className={showTotal ? 'is-active' : ''} aria-pressed={showTotal} onClick={() => setShowTotal(true)}>Drive-away</button>
        </div>
      </div>
      <ol className="dd-offer-list">
        {sorted.map((offer, index) => (
          <motion.li layout key={offer.name} className={index === 0 ? 'is-best' : ''}>
            <span className="dd-offer-rank">{index + 1}</span>
            <span className="dd-offer-dealer">
              <strong>{offer.name} <BadgeCheck size={15} aria-label="Verified dealer" /></strong>
              <small>{showTotal ? `Vehicle ${formatMoney(offer.vehicle)} + tax, title and fee` : 'Advertised vehicle price'}</small>
            </span>
            <span className="dd-offer-price">
              <strong>{formatMoney(showTotal ? offer.total : offer.vehicle)}</strong>
              <small>{showTotal ? 'out the door' : 'vehicle only'}</small>
            </span>
          </motion.li>
        ))}
      </ol>
      <div className="dd-offer-insight">
        <CircleDollarSign size={18} />
        <span><strong>Premier Cars saves $391.</strong> The lowest advertised price is not the lowest final price.</span>
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="dd-section dd-faq" id="faq">
      <div className="dd-shell dd-faq-grid">
        <Reveal>
          <div className="dd-section-copy">
            <span className="dd-kicker">Clear answers</span>
            <h2>Know what happens before you begin.</h2>
            <p>Buying a car is a big decision. The process should never feel vague.</p>
            <Link className="dd-text-link" to="/terms">Read how the platform works <ArrowRight size={16} /></Link>
          </div>
        </Reveal>
        <div className="dd-faq-list">
          {faqs.map(({ question, answer }, index) => {
            const isOpen = open === index;
            return (
              <Reveal key={question} delay={index * 0.04}>
                <article className={`dd-faq-item${isOpen ? ' is-open' : ''}`}>
                  <h3>
                    <button type="button" onClick={() => setOpen(isOpen ? null : index)} aria-expanded={isOpen} aria-controls={`dd-faq-${index}`}>
                      <span>{question}</span><ChevronDown size={20} />
                    </button>
                  </h3>
                  <div className="dd-faq-answer" id={`dd-faq-${index}`}><p>{answer}</p></div>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default function LandingScreen() {
  useScrollTopOnPush();
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    document.title = 'Deal&Drive | One request. Real dealer offers.';
  }, []);

  return (
    <div className="dd-page">
      <motion.div className="dd-progress" style={{ scaleX: progress }} aria-hidden="true" />
      <header className="dd-header">
        <div className="dd-shell dd-nav">
          <Link to="/" aria-label="Deal&Drive home"><Brand /></Link>
          <nav aria-label="Main navigation">
            <a href="#process">How it works</a>
            <a href="#trust">Safety</a>
            <Link to="/dealers">For dealers</Link>
          </nav>
          <div className="dd-nav-actions">
            <Link className="dd-button dd-button-quiet" to="/login">Log in</Link>
            <Link className="dd-button dd-button-primary" to="/signup/buyer">Start a request <ArrowRight size={17} /></Link>
          </div>
        </div>
      </header>

      <main>
        <section className="dd-hero">
          <div className="dd-hero-background" aria-hidden="true">
            <img src={heroImage} alt="" fetchPriority="high" />
          </div>
          <div className="dd-shell dd-hero-inner">
            <motion.div className="dd-hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
              <span className="dd-kicker">A better way to buy a car</span>
              <h1><span>Dealers compete.</span><span>You drive.</span></h1>
              <p>Create one private request and compare verified, itemized offers by the real drive-away price.</p>
              <div className="dd-hero-actions">
                <Link className="dd-button dd-button-primary" to="/signup/buyer">Start a request <ArrowRight size={18} /></Link>
                <a className="dd-button dd-button-secondary" href="#process">See how it works</a>
              </div>
              <div className="dd-hero-facts" aria-label="Key service details">
                <span><strong>Free</strong><small>for buyers</small></span>
                <span><strong>Private</strong><small>until you choose</small></span>
                <span><strong>Itemized</strong><small>drive-away totals</small></span>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="dd-proof" aria-label="Platform benefits">
          <div className="dd-shell dd-proof-grid">
            <span><ShieldCheck size={20} /><strong>Verified dealers</strong><small>Reviewed before they quote</small></span>
            <span><LockKeyhole size={20} /><strong>Buyer-controlled privacy</strong><small>Contact stays hidden</small></span>
            <span><FileCheck2 size={20} /><strong>Itemized pricing</strong><small>Compare the complete total</small></span>
            <span><CircleDollarSign size={20} /><strong>Free for buyers</strong><small>No platform fee to shop</small></span>
          </div>
        </section>

        <section className="dd-section" id="process">
          <div className="dd-shell dd-process-grid">
            <Reveal from="left" once className="dd-process-media">
              <img src={graphiteSuvImage} alt="Graphite SUV in a modern automotive studio" loading="lazy" />
              <span className="dd-photo-note"><Car size={17} /> You describe the car. Dealers find the match.</span>
            </Reveal>
            <div className="dd-process-copy">
              <Reveal>
                <h2>Skip the dealership runaround.</h2>
                <p>Deal&Drive turns your preferences into a private buying brief that nearby verified dealers can compete for.</p>
              </Reveal>
              <div className="dd-process-list">
                <Reveal delay={0.04}><article><span><FileCheck2 /></span><div><h3>Build a clear request</h3><p>Add the vehicle, budget, location, timeframe, trade-in, and must-have equipment.</p></div></article></Reveal>
                <Reveal delay={0.1}><article><span><Store /></span><div><h3>Receive complete offers</h3><p>Matched dealers respond with one itemized out-the-door total, not a teaser price.</p></div></article></Reveal>
                <Reveal delay={0.16}><article><span><Check /></span><div><h3>Choose without pressure</h3><p>Compare, negotiate, or walk away. Your contact details remain yours until you decide.</p></div></article></Reveal>
              </div>
            </div>
          </div>
        </section>

        <section className="dd-section dd-price-section" id="pricing">
          <div className="dd-shell dd-price-grid">
            <Reveal from="left" once>
              <div className="dd-section-copy">
                <span className="dd-kicker">The number that matters</span>
                <h2>Compare what you will actually pay.</h2>
                <p>Every offer separates the vehicle, tax, title, registration, dealer fee, and trade-in credit before it reaches you.</p>
                <ul className="dd-check-list">
                  <li><Check size={16} /> No hidden documentation fee</li>
                  <li><Check size={16} /> Like-for-like dealer ranking</li>
                  <li><Check size={16} /> Revised offers update instantly</li>
                </ul>
              </div>
            </Reveal>
            <Reveal from="right" once><OfferComparison /></Reveal>
          </div>
        </section>

        <section className="dd-section" id="trust">
          <div className="dd-shell">
            <Reveal>
              <div className="dd-trust-heading">
                <h2>No surprise calls. No mystery totals. No pressure.</h2>
                <p>Dealers compete on the quality of their offer while you stay in control of your identity and decision.</p>
              </div>
            </Reveal>
            <div className="dd-trust-layout">
              <div className="dd-trust-points">
                <Reveal from="left" once><article><ShieldCheck /><div><h3>Dealer verification</h3><p>Dealership and licence details are reviewed before access is approved.</p></div></article></Reveal>
                <Reveal from="left" once delay={0.06}><article><LockKeyhole /><div><h3>Private by default</h3><p>Dealers see your request, never your direct contact details, until you choose.</p></div></article></Reveal>
                <Reveal from="left" once delay={0.12}><article><MessageCircle /><div><h3>Negotiation stays organized</h3><p>Questions, revisions, and accepted terms remain attached to the offer.</p></div></article></Reveal>
              </div>
              <Reveal from="right" once className="dd-trust-image"><img src={buyerInspectionImage} alt="Buyer inspecting a graphite sedan in a modern dealership" loading="lazy" /></Reveal>
            </div>
          </div>
        </section>

        <section className="dd-section dd-sera-section">
          <div className="dd-shell dd-sera-grid">
            <Reveal from="left" once>
              <div className="dd-sera-demo">
                <div className="dd-sera-head"><span><Sparkles size={18} /></span><div><strong>Sera</strong><small>Your buyer-side car advisor</small></div></div>
                <div className="dd-message is-user">I need a reliable AWD SUV under $45,000 with room for two child seats.</div>
                <div className="dd-message">I can turn that into a private dealer request. Do you prefer hybrid, petrol, or either?</div>
                <div className="dd-request-preview"><span>Request draft</span><strong>AWD family SUV</strong><small>Up to $45,000, within 50 miles, two-week timeframe</small></div>
              </div>
            </Reveal>
            <Reveal from="right" once>
              <div className="dd-section-copy">
                <h2>Tell Sera what life needs from your car.</h2>
                <p>Start with a plain-language conversation. Review every detail before your request reaches a dealer.</p>
                <ul className="dd-check-list">
                  <li><Check size={16} /> Turn needs into a complete buying brief</li>
                  <li><Check size={16} /> Compare equipment and total cost</li>
                  <li><Check size={16} /> Nothing publishes without approval</li>
                </ul>
                <Link className="dd-button dd-button-primary" to="/signup/buyer">Start a request <ArrowRight size={17} /></Link>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="dd-section dd-dealer-section">
          <div className="dd-shell dd-dealer-card">
            <div>
              <Store size={28} />
              <h2>Real buyer intent for verified dealerships.</h2>
              <p>See exact vehicle demand, send one transparent offer, and spend time on buyers who are ready to decide.</p>
            </div>
            <div className="dd-dealer-actions">
              <Link className="dd-button dd-button-primary" to="/signup/dealer">Join as a dealer <ArrowRight size={17} /></Link>
              <Link className="dd-button dd-button-secondary" to="/dealers">Explore dealer tools</Link>
            </div>
          </div>
        </section>

        <Faq />

        <section className="dd-final">
          <div className="dd-shell dd-final-inner">
            <div>
              <h2>Make the market compete for your next car.</h2>
            </div>
            <Link className="dd-button dd-button-primary" to="/signup/buyer">Start a request <ArrowRight size={18} /></Link>
          </div>
        </section>
      </main>

      <footer className="dd-footer">
        <div className="dd-shell">
          <Brand />
          <p>Clear offers. Private details. Your decision.</p>
          <nav aria-label="Footer navigation"><Link to="/dealers">For dealers</Link><Link to="/login">Log in</Link><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link></nav>
          <small>© 2026 Deal&amp;Drive</small>
        </div>
      </footer>
    </div>
  );
}
