import { motion, useReducedMotion, useScroll, useSpring, useTransform, type Variants } from 'motion/react';
import { ArrowRight, BadgeCheck, BellRing, Check, Handshake, Info, Plus, Send, ShieldCheck, Trophy, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import heroImage from '@/assets/vehicles/drivedeal-hero.png';
import { useScrollTopOnPush } from '@/helpers/useScrollTopOnPush';
import { spyLinkProps, useScrollSpy } from '@/helpers/useScrollSpy';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { SerraIcon } from '@/ui/reusables/Icons/SerraIcon';
import { BenefitsSection, CompareSection, HowSection, JourneySection, SeraSection } from './CustomerSections';
import './LandingScreen.css';

const steps = [
  { owner: 'You', icon: Send, title: 'Post your request', body: 'Share make, model, trim, color, and how far you will travel—or let Sera build it from a conversation.' },
  { owner: 'We', icon: BellRing, title: 'Matching dealers are notified', body: 'Dealers inside your radius who can deliver the car see the request. Your name and contact details stay hidden.' },
  { owner: 'Dealers', icon: Handshake, title: 'Quotes come to you', body: 'Each dealer submits an itemized out-the-door quote covering vehicle, tax, title, licence, and fees.' },
  { owner: 'You', icon: Trophy, title: 'Compare, negotiate, accept', body: 'Quotes are ranked by final price. Compare with Sera, negotiate in-platform, and accept the offer you prefer.' },
];

const faqs = [
  { question: 'Is Deal&Drive free for buyers?', answer: 'Yes, it is free for buyers. Posting a request, receiving quotes, comparing offers, negotiating, and working with Sera never cost you anything. Dealers pay only when a deal closes, so they are rewarded for winning your business with a competitive offer, not for chasing you.' },
  { question: 'What does “out-the-door” actually include?', answer: 'Every quote is itemized and covers the vehicle price, sales tax, title, license, and the dealer’s doc fee. That total is what you would actually pay to drive the car away, so nothing surprising gets added later. Quotes are ranked by this final number, which keeps every comparison like for like.' },
  { question: 'How anonymous am I, really?', answer: 'Dealers see the car you want, your target price, and how far you will travel. They never see your name, phone number, or email. Your details stay hidden while quotes arrive and while you negotiate in-platform, and they are shared only once you accept a quote, so you decide who hears from you.' },
  { question: 'Can I include a trade-in or financing?', answer: 'Yes. Add your trade-in details or your financing preference when you build your request, and dealers will factor them into their quote. Instead of juggling separate numbers for the car, the trade, and the loan, you get one final figure from each dealer that you can compare side by side.' },
  { question: 'What is Sera?', answer: 'Sera is our AI advisor. Describe the car you want in plain language and Sera builds your request for you, including make, model, trim, color, target price, and travel distance. Nothing is sent to dealers until you review it and give your OK, and Sera can also help you compare quotes once they come in.' },
  { question: 'Do I have to accept a quote?', answer: 'No. A quote is an offer, not a commitment. Only you can accept one, and until you do you can keep comparing, ask questions in the in-platform chat, or decline offers you don’t like. Accepting is the final step, so take your time.' },
  { question: 'Can I negotiate the price?', answer: 'Yes. Open a chat on any quote and negotiate with the dealer in the platform. Dealers can revise their itemized quote, and your ranking updates as they do, so you always see the best total first.' },
  { question: 'Are the dealers verified?', answer: 'Yes. Every dealer applies with their dealership details and licence number, and our support team reviews each application. Dealers can’t see a single request or send a quote until they’re approved.' },
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

const rise: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: .8, ease: [.16, 1, .3, 1] } },
};
const lineUp: Variants = {
  hidden: { y: '108%' },
  show: { y: '0%', transition: { duration: .95, ease: [.16, 1, .3, 1] } },
};
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: .1, delayChildren: .1 } },
};

function Hero() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const imageY = useTransform(scrollYProgress, [0, 1], ['0%', '6%']);
  const imageScale = useTransform(scrollYProgress, [0, 1], [1.06, 1.16]);
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', '12%']);
  const copyOpacity = useTransform(scrollYProgress, [0, .7], [1, 0]);
  const imageStyle = reduceMotion ? {} : { y: imageY, scale: imageScale };
  const copyStyle = reduceMotion ? {} : { y: copyY, opacity: copyOpacity };

  return (
    <section className="hero" ref={ref}>
      <motion.img className="hero-image" src={heroImage} alt="Deep blue sedan on a warm modern forecourt at sunset" fetchPriority="high" style={imageStyle} />
      <div className="shell">
        <motion.div className="hero-content" variants={stagger} initial={reduceMotion ? 'show' : 'hidden'} animate="show" style={copyStyle}>
          <motion.span variants={rise} className="eyebrow">Dealers compete. You decide.</motion.span>
          <h1>
            <span className="lp-line"><motion.span variants={lineUp} className="lp-line-inner">Your car.</motion.span></span>
            <span className="lp-line"><motion.span variants={lineUp} className="lp-line-inner">Their best offer.</motion.span></span>
          </h1>
          <motion.p variants={rise}>Stop chasing listings. Tell verified dealers what you want and let clear, itemized offers come to you.</motion.p>
          <motion.div variants={rise} className="hero-actions"><Link className="button button-primary" to="/signup/buyer">Create a buyer request <ArrowRight size={18} /></Link><Link className="button button-secondary" to="/signup/dealer">I represent a dealership</Link></motion.div>
          <motion.div variants={rise} className="hero-trust"><span><ShieldCheck size={16} /> Verified dealer network</span><span><Check size={16} /> Itemized pricing</span><span><SerraIcon size={16} /> Buyer-side AI guidance</span></motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/** Section id → header link it highlights. The sections between "how" and "why" belong to the "How it works" story. */
const NAV_SECTIONS = { how: 'how', sera: 'how', compare: 'how', benefits: 'how', journey: 'how', why: 'why' };

export default function LandingScreen() {
  useScrollTopOnPush();
  const activeNav = useScrollSpy(NAV_SECTIONS);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: .001 });

  return (
    <div className="lp-page">
      <motion.div className="lp-progress" style={{ scaleX: progress }} aria-hidden="true" />
      <header className={`public-header${scrolled ? ' is-scrolled' : ''}`}><div className="shell public-nav"><Link to="/"><Brand /></Link><nav className="public-nav-links" aria-label="Sections"><a {...spyLinkProps(activeNav, 'how')} href="#how">How it works</a><a {...spyLinkProps(activeNav, 'why')} href="#why">Why choose us</a><Link className="nav-link" to="/dealers">For dealers</Link><Link className="nav-link dealer-entry" to="/login?role=dealer">Dealer sign in</Link></nav><div className="public-nav-actions"><Link className="button button-secondary public-login" to="/login">Log in</Link><Link className="button button-primary" to="/signup/buyer">Start buying <ArrowRight size={17} /></Link></div></div></header>
      <Hero />
      <HowSection steps={steps} />
      <SeraSection />
      <CompareSection />
      <BenefitsSection />
      <JourneySection />
      <section className="section difference-section" id="why"><div className="shell difference-grid"><Reveal from="left" once className="difference-item"><article className="difference-copy"><span className="eyebrow">Our difference</span><h2>Why choose us</h2><p>Deal&amp;Drive is free for customers, with AI guidance that makes buying simpler and smarter. Dealers compete on your terms, every quote is itemized, and the price you compare includes tax, title, licence, and fees.</p><div className="difference-points"><span><BadgeCheck /> Complete out-the-door totals</span><span><ShieldCheck /> Private until you choose</span><span><SerraIcon size={24} /> Buyer-side AI guidance</span></div></article></Reveal><Reveal from="right" once className="difference-item" delay={.08}><article className="card dealer-callout" id="dealers"><div className="dealer-callout-head"><div className="dealer-callout-icon"><UserRound /></div><span className="eyebrow">For dealers</span></div><h2>Serious buyers. Zero cold leads.</h2><p>Every request is a real person who shared the exact car, location, and timeframe. Quote once, compete transparently, and win business your BDC never had to chase.</p><div className="dealer-callout-actions"><Link className="button button-primary" to="/signup/dealer">Join as a dealer <ArrowRight size={17} /></Link><Link className="button button-secondary" to="/dealers">More info <Info size={17} /></Link></div></article></Reveal></div></section>
      <section className="section surface-section"><div className="shell"><Reveal><div className="card cta-card"><div><span className="eyebrow">Ready when you are</span><h2>Make dealers compete for your business.</h2><p className="muted">Tell us the car you want, your target out-the-door price, and how far you will travel. Verified dealers near you send itemized quotes covering vehicle, tax, title, licence, and fees, so you compare real totals instead of teaser prices. A request takes only a few minutes, and Sera can help you work out the details without publishing anything until you approve it.</p><div className="difference-points"><span><BadgeCheck /> Free for buyers</span><span><ShieldCheck /> Details private until you choose</span><span><SerraIcon size={24} /> Nothing published without your OK</span></div></div><Link className="button button-primary" to="/signup/buyer">Build my request <ArrowRight size={18} /></Link></div></Reveal></div></section>
      <FaqSection />
      <footer className="public-footer"><div className="shell"><span>© 2026 Deal&amp;Drive. Built for confident car buying.</span><span><Link to="/dealers">For dealers</Link> · <Link to="/login?role=dealer">Dealer portal</Link> · <Link to="/login?role=support">Team access</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></span></div></footer>
    </div>
  );
}
