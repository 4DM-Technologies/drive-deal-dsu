import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform, type Variants } from 'motion/react';
import {
  ArrowRight, BadgeCheck, Calculator, Check, ChevronDown, ClipboardCheck, Crown, Handshake, LockKeyhole, LockOpen, Mail,
  Phone, Plus, Radar, ReceiptText, Send, ShieldCheck, SlidersHorizontal, Sparkles, Store, Trophy, UserRound, Users, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useScrollTopOnPush } from '@/helpers/useScrollTopOnPush';
import { spyLinkProps, useScrollSpy } from '@/helpers/useScrollSpy';
import { AnimatedNumber } from '@/ui/reusables/AnimatedNumber/AnimatedNumber';
import { Brand } from '@/ui/reusables/Brand/Brand';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { SpotlightCard } from '@/ui/reusables/SpotlightCard/SpotlightCard';
import './DealerLandingScreen.css';

/* Drop a generated image at src/assets/vehicles/dealer-hero.(png|jpg|jpeg|webp|avif) and it becomes the hero
   background automatically. Until then the hero renders a built-in gradient backdrop. */
const heroImages = import.meta.glob<string>('../../../assets/vehicles/dealer-hero.{png,jpg,jpeg,webp,avif}', { eager: true, query: '?url', import: 'default' });
const dealerHeroImage = Object.values(heroImages)[0];
/* Optional separate backdrop for the closing call to action: src/assets/vehicles/dealer-cta.(png|jpg|jpeg|webp|avif).
   Without it the section uses the blue gradient. */
const ctaImages = import.meta.glob<string>('../../../assets/vehicles/dealer-cta.{png,jpg,jpeg,webp,avif}', { eager: true, query: '?url', import: 'default' });
const dealerCtaImage = Object.values(ctaImages)[0];

/** Dealer membership price shown on this page. It mirrors the backend's DEALER_PREMIUM_PRICE (USD per year). */
const MEMBERSHIP_PRICE = '$500';

const steps = [
  { n: '01', icon: Send, title: 'Request Enters the System', body: 'A buyer specifies their exact car—make, model, and trim—and it’s instantly logged to the network. No cold calling required.', tag: 'No cold calling' },
  { n: '02', icon: Radar, title: 'Dashboard Flags the Match', body: 'Matching requests appear against your live inventory instantly, eliminating the need to manually triage lead lists.', tag: 'Live inventory match' },
  { n: '03', icon: Calculator, title: 'You Set the Price', body: 'Set your out-the-door quote against your margin targets. The dashboard displays your win probability before you even submit.', tag: 'Win probability shown' },
  { n: '04', icon: Handshake, title: 'Deal Closes, Books Update', body: 'If the buyer accepts your offer, you receive their full contact details so you can finalize the deal in person.', tag: 'Contact details unlocked' },
];

const oldWay = [
  'Hours lost on the showroom floor',
  'Cold-calling stale lead lists',
  'Triaging inquiries that never convert',
  'Teaser prices that unravel at the desk',
  'Buyers who ghost after one call',
];
const newWay = [
  'One number you choose, then you’re done',
  'Matches flagged against your live inventory',
  'Itemized out-the-door quotes buyers can compare',
  'Win probability before you hit send',
  'Contact details the moment a buyer accepts',
];

const startSteps = [
  { icon: ClipboardCheck, title: 'Apply', body: 'Tell us about your dealership: licence number, branch, location, and the brands you carry.' },
  { icon: ShieldCheck, title: 'Get verified', body: 'Our support team reviews every application, so buyers only ever meet real, licensed dealers. You’ll get an email as soon as you’re approved.' },
  { icon: Trophy, title: 'Start quoting', body: 'Open your feed, pick the requests you can fill, and send an itemized quote. Buyers do the choosing.' },
];

const faqs = [
  { question: 'What does it cost to be on Deal&Drive?', answer: `Start free: your first 2 months include up to 3 quotes. After that, a dealer membership is ${MEMBERSHIP_PRICE} a year for unlimited quotes, and each renewal adds another year.` },
  { question: 'How are requests matched to my dealership?', answer: 'Buyers choose a search radius, and you’re notified about requests inside it. Your feed is built around the brands you carry, and you can filter by brand, body type, budget, distance, and timeframe to focus on the cars you can deliver.' },
  { question: 'What does the buyer see in my quote?', answer: 'An itemized out-the-door breakdown: vehicle price, documentation fee, sales tax, title and registration, and any trade-in credit, rolled into one final total. Quotes are ranked by that number, so every comparison is like for like.' },
  { question: 'When do I get the buyer’s contact details?', answer: 'Buyers stay anonymous while quotes arrive and while you negotiate in-platform. When a buyer accepts your quote, you receive their full contact details so you can finalize the deal in person.' },
  { question: 'Can I change or pull a quote?', answer: 'Yes. You hold one live quote per request, which you can revise as the market moves, withdraw if the car is no longer available, or set to expire on a date you choose.' },
  { question: 'How does dealer verification work?', answer: 'You apply with your dealership details, licence number, and supported brands. Our support team reviews each application, and you’ll receive an email once your account is approved. Sign-in stays locked until then, which keeps the network trustworthy for buyers.' },
];

const rise: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: .8, ease: [.16, 1, .3, 1] } },
};
const lineUp: Variants = {
  hidden: { y: '108%' },
  show: { y: '0%', transition: { duration: .95, ease: [.16, 1, .3, 1] } },
};
const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: .11, delayChildren: .12 } },
};

const percent = (value: number) => `${Math.round(value)}%`;

function SectionHead({ eyebrow, title, children, tone = 'light' }: { eyebrow: string; title: ReactNode; children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <Reveal>
      <div className={`dl-head${tone === 'dark' ? ' is-dark' : ''}`}>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </Reveal>
  );
}

function Hero() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const mediaY = useTransform(scrollYProgress, [0, 1], ['0%', '12%']);
  const mediaScale = useTransform(scrollYProgress, [0, 1], [1, 1.1]);
  const copyY = useTransform(scrollYProgress, [0, 1], ['0%', '14%']);
  const copyOpacity = useTransform(scrollYProgress, [0, .7], [1, 0]);
  const mediaStyle = reduceMotion ? {} : { y: mediaY, scale: mediaScale };
  const copyStyle = reduceMotion ? {} : { y: copyY, opacity: copyOpacity };

  return (
    <section className="dl-hero" ref={ref}>
      <motion.div className="dl-hero-media" style={mediaStyle}>
        {dealerHeroImage ? <img src={dealerHeroImage} alt="" fetchPriority="high" /> : <div className="dl-hero-fallback" />}
      </motion.div>
      <div className="dl-hero-shade" />
      <div className="shell dl-hero-inner">
        <motion.div className="dl-hero-copy" style={copyStyle}>
          <motion.div variants={stagger} initial={reduceMotion ? 'show' : 'hidden'} animate="show">
            <motion.span variants={rise} className="dl-eyebrow"><i /> For dealerships</motion.span>
            <h1>
              <span className="dl-line"><motion.span variants={lineUp} className="dl-line-inner">No More Hours on the Floor.</motion.span></span>
              <span className="dl-line"><motion.span variants={lineUp} className="dl-line-inner dl-grad">Just a Number You Choose.</motion.span></span>
            </h1>
            <motion.p variants={rise}>Deal&amp;Drive sends you real buyers who already know the exact car they want. See the match on your dashboard, set one itemized out-the-door price, and let the buyer decide—no cold calls, no lead lists, no waiting around the showroom.</motion.p>
            <motion.div variants={rise} className="dl-hero-actions">
              <Link className="button button-primary dl-cta-main" to="/signup/dealer">Join as a dealer <ArrowRight size={18} /></Link>
              <a className="button dl-btn-glass" href="#dl-how">See how it works <ChevronDown size={17} /></a>
            </motion.div>
            <motion.div variants={rise} className="dl-hero-trust">
              <span><ShieldCheck size={16} /> Verified dealer network</span>
              <span><ReceiptText size={16} /> Itemized quotes</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

function Timeline() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 72%', 'end 58%'] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: .001 });
  const [reached, setReached] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (progress) => setReached(steps.filter((_, index) => progress >= (index + .5) / steps.length - .05).length));
  const activeCount = reduceMotion ? steps.length : reached;

  return (
    <ol className="dl-timeline" ref={ref}>
      <div className="dl-rail" aria-hidden="true"><motion.div className="dl-rail-fill" style={reduceMotion ? { scaleY: 1 } : { scaleY: fill }} /></div>
      {steps.map(({ n, icon: Icon, title, body, tag }, index) => {
        const side = index % 2 === 0 ? 'left' : 'right';
        const active = index < activeCount;
        return (
          <li className={`dl-step is-${side}${active ? ' is-active' : ''}`} key={n}>
            <span className="dl-step-node" aria-hidden="true">{n}</span>
            <Reveal from={side} once className="dl-step-slot">
              <article className="dl-step-card">
                <span className="dl-step-ghost" aria-hidden="true">{n}</span>
                <span className="dl-step-icon"><Icon size={22} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="dl-step-tag"><Check size={13} /> {tag}</span>
              </article>
            </Reveal>
          </li>
        );
      })}
    </ol>
  );
}

const INITIAL_LEADS = [
  { car: 'Toyota RAV4 Hybrid XLE', meta: '9 mi · within 2 weeks' },
  { car: 'Honda Civic Sport', meta: '14 mi · this month' },
  { car: 'Ford F-150 Lariat', meta: '22 mi · within 3 weeks' },
];
const LEADS_ROTATE_MS = 2600;

function LeadsVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -10% 0px' });
  const reduceMotion = useReducedMotion();
  const [rows, setRows] = useState(INITIAL_LEADS);

  // Cycles the list like a leaderboard - the top request steps to the back and the other two move up to fill
  // in, so every request gets a turn at the top. Paused off-screen and for anyone who asked for less motion.
  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = window.setInterval(() => {
      setRows((current) => [...current.slice(1), current[0]!]);
    }, LEADS_ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [inView, reduceMotion]);

  return (
    <div className="dl-leads" ref={ref}>
      {rows.map(({ car, meta }, index) => (
        <motion.div
          className="dl-lead-row"
          key={car}
          layout
          initial={reduceMotion ? false : { opacity: 0, x: 48 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: .6 }}
          transition={{
            default: { duration: .7, delay: .15 + index * .12, ease: [.16, 1, .3, 1] },
            layout: { duration: .6, ease: [.16, 1, .3, 1] },
          }}
        >
          <span className="dl-lead-avatar"><UserRound size={16} /></span>
          <div><strong>{car}</strong><small>{meta}</small></div>
          <span className="dl-lead-real"><BadgeCheck size={14} /> Real request</span>
        </motion.div>
      ))}
    </div>
  );
}

function FilterVisual() {
  const chips = ['Toyota', 'Honda', 'Within 50 mi', 'SUV', 'Under $45k', 'This month'];
  return (
    <div className="dl-match">
      <div className="dl-radar" aria-hidden="true">
        <i /><i /><i /><u /><u /><u />
        <b><Store size={15} /></b>
        <em>50 mi</em>
      </div>
      <div className="dl-filters">
        {chips.map((chip, index) => (
          <motion.span key={chip} className={index < 3 ? 'is-on' : ''} initial={{ opacity: 0, scale: .85 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: .8 }} transition={{ duration: .5, delay: .1 + index * .07, ease: [.16, 1, .3, 1] }}>
            {index < 3 && <Check size={12} />}{chip}
          </motion.span>
        ))}
      </div>
    </div>
  );
}

function GaugeVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -12% 0px' });
  return (
    <div className="dl-gauge" ref={ref}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <linearGradient id="dl-gauge-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#5b9bff" /><stop offset="1" stopColor="#1456b8" /></linearGradient>
        </defs>
        <circle className="dl-gauge-track" cx="60" cy="60" r="50" />
        <motion.circle className="dl-gauge-bar" cx="60" cy="60" r="50" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: inView ? .84 : 0, opacity: inView ? 1 : 0 }} transition={{ duration: 1.7, ease: [.16, 1, .3, 1] }} />
      </svg>
      <div className="dl-gauge-text"><strong><AnimatedNumber value={84} format={percent} active={inView} /></strong><span>win probability</span></div>
    </div>
  );
}

function ItemizedVisual() {
  const lines = [['Vehicle price', '$36,400'], ['Sales tax · 6.25%', '$2,275'], ['Doc fee', '$650'], ['Title & registration', '$225']];
  return (
    <div className="dl-lines">
      {lines.map(([label, value], index) => (
        <motion.div key={label} initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .8 }} transition={{ duration: .6, delay: .1 + index * .09, ease: [.16, 1, .3, 1] }}>
          <span>{label}</span><b>{value}</b>
        </motion.div>
      ))}
      <motion.div className="dl-lines-total" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: .8 }} transition={{ duration: .6, delay: .5 }}>
        <span>Out-the-door</span><b>$39,550</b>
      </motion.div>
    </div>
  );
}

function UnlockVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!inView) return;
    const timer = window.setTimeout(() => setOpen(true), 750);
    return () => window.clearTimeout(timer);
  }, [inView]);
  return (
    <div className={`dl-unlock${open ? ' is-open' : ''}`} ref={ref}>
      <div className="dl-unlock-state">{open ? <LockOpen size={15} /> : <LockKeyhole size={15} />}<em>{open ? 'Buyer accepted' : 'Identity protected'}</em></div>
      <div className="dl-unlock-card">
        <span><UserRound size={15} /><b>Buyer name</b></span>
        <span><Phone size={15} /><b>(555) 014-2290</b></span>
        <span><Mail size={15} /><b>buyer@email.com</b></span>
      </div>
    </div>
  );
}

const EASE_OUT = [.16, 1, .3, 1] as const;

function MembershipVisual() {
  return (
    <div className="dl-member-visual">
      <motion.div className="dl-member-card" initial={{ opacity: 0, y: 24, rotate: -1.5 }} whileInView={{ opacity: 1, y: 0, rotate: 0 }} viewport={{ once: true, amount: .6 }} transition={{ duration: .7, ease: EASE_OUT }}>
        <div className="dl-mc-top"><span className="dl-mc-brand">Deal&amp;Drive</span><span className="dl-mc-tier"><Crown size={13} /> Member</span></div>
        <div className="dl-mc-price"><b>{MEMBERSHIP_PRICE}</b><span>per year</span></div>
        <div className="dl-mc-facts">
          <div><small>Plan</small><strong>Dealer membership</strong></div>
          <div><small>Quotes</small><strong>Unlimited</strong></div>
          <div><small>Valid for</small><strong>12 months</strong></div>
        </div>
      </motion.div>
      <motion.div className="dl-offer" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .8 }} transition={{ duration: .6, delay: .2, ease: EASE_OUT }}>
        <div className="dl-offer-step is-free"><small>Launching offer</small><strong>Free for 2 months</strong><span>Up to 3 quotes included</span></div>
        <span className="dl-offer-arrow" aria-hidden="true"><ArrowRight size={16} /></span>
        <div className="dl-offer-step"><small>Then</small><strong>{MEMBERSHIP_PRICE} a year</strong><span>Unlimited quotes</span></div>
      </motion.div>
    </div>
  );
}

function Features() {
  return (
    <section className="dl-section dl-features" id="dl-features">
      <div className="shell">
        <SectionHead eyebrow="Why dealers join" title="Built for dealers who’d rather sell than chase.">
          Every part of the platform exists to cut the busywork between a serious buyer and your signature.
        </SectionHead>
        <div className="dl-bento">
          <Reveal from="left" once className="dl-b-wide">
            <SpotlightCard className="dl-card">
              <span className="dl-card-icon"><Users size={21} /></span>
              <h3>Zero cold leads</h3>
              <p>Every request is a real person who shared the exact car, location, and timeframe. Nothing to qualify and nothing to chase—just demand you can fill.</p>
              <LeadsVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="right" once className="dl-b-narrow">
            <SpotlightCard className="dl-card">
              <span className="dl-card-icon"><SlidersHorizontal size={21} /></span>
              <h3>Matched to your lot</h3>
              <p>Requests inside your radius for the brands you carry rise to the top of your feed.</p>
              <FilterVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="left" once className="dl-b-third">
            <SpotlightCard className="dl-card">
              <span className="dl-card-icon"><Sparkles size={21} /></span>
              <h3>Know your odds first</h3>
              <p>See your win probability before you submit, then adjust the number with confidence.</p>
              <GaugeVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal once delay={.08} className="dl-b-third">
            <SpotlightCard className="dl-card">
              <span className="dl-card-icon"><ReceiptText size={21} /></span>
              <h3>One itemized number</h3>
              <p>Quote vehicle, tax, title, and fees line by line. The out-the-door total is what competes.</p>
              <ItemizedVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="right" once className="dl-b-third">
            <SpotlightCard className="dl-card">
              <span className="dl-card-icon"><LockKeyhole size={21} /></span>
              <h3>Contacts on acceptance</h3>
              <p>Buyers stay private while you compete. Once they accept, their full details are yours.</p>
              <UnlockVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal once className="dl-b-full">
            <SpotlightCard className="dl-card dl-card-dark">
              <div className="dl-member">
                <div className="dl-member-copy">
                  <div className="dl-member-head"><span className="dl-card-icon"><Crown size={21} /></span><span className="dl-member-pill">Membership</span></div>
                  <h3>Dealer membership</h3>
                  <p>One flat price for the year. Start free, then keep quoting on every buyer request that fits your lot, with no limit on how many quotes you send.</p>
                  <ul className="dl-member-perks">
                    <li><Check size={15} /> Unlimited quotes on live buyer requests</li>
                    <li><Check size={15} /> A full year of access, renew any time</li>
                    <li><Check size={15} /> Buyer contact details unlock when they accept</li>
                  </ul>
                  <Link className="button button-primary dl-member-cta" to="/signup/dealer">Start free for 2 months <ArrowRight size={17} /></Link>
                </div>
                <MembershipVisual />
              </div>
            </SpotlightCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Versus() {
  return (
    <section className="dl-section dl-versus-section" id="dl-versus">
      <div className="shell">
        <SectionHead eyebrow="The difference" title="Stop working leads. Start winning deals.">
          See what changes when buyers arrive with the exact car already chosen.
        </SectionHead>
        <div className="dl-versus">
          <Reveal from="left" once className="dl-vs-slot">
            <article className="dl-vs dl-vs-old">
              <span className="dl-vs-label">The old way</span>
              <h3>Chasing leads on the floor</h3>
              <ul>{oldWay.map((item) => <li key={item}><span><X size={14} /></span>{item}</li>)}</ul>
            </article>
          </Reveal>
          <div className="dl-vs-badge" aria-hidden="true">VS</div>
          <Reveal from="right" once className="dl-vs-slot">
            <article className="dl-vs dl-vs-new">
              <span className="dl-vs-label">With Deal&amp;Drive</span>
              <h3>Quoting buyers who are ready</h3>
              <ul>{newWay.map((item) => <li key={item}><span><Check size={14} /></span>{item}</li>)}</ul>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function GetStarted() {
  return (
    <section className="dl-section dl-start-section" id="dl-start">
      <div className="shell">
        <SectionHead eyebrow="Get started" title="Live on the platform in three steps.">
          Apply once, get verified, and start answering buyers who are ready to commit.
        </SectionHead>
        <div className="dl-start-grid">
          {startSteps.map(({ icon: Icon, title, body }, index) => (
            <Reveal key={title} from={index === 0 ? 'left' : index === 2 ? 'right' : 'up'} once delay={index === 1 ? .1 : 0}>
              <article className="dl-start-card">
                <div className="dl-start-top"><span className="dl-start-num">{index + 1}</span><span className="dl-start-icon"><Icon size={22} /></span></div>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function DealerFaq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="section faq-section dl-faq" id="dl-faq">
      <div className="shell">
        <Reveal>
          <div className="faq-head">
            <h2>Dealer FAQ</h2>
            <p>Straight answers about pricing, privacy, and how quoting works.</p>
          </div>
        </Reveal>
        <Reveal delay={.06}>
          <div className="faq-list">
            {faqs.map(({ question, answer }, index) => {
              const isOpen = open === index;
              return (
                <div key={question} className={`faq-item${isOpen ? ' open' : ''}`}>
                  <h3>
                    <button type="button" className="faq-question" id={`dl-faq-q-${index}`} aria-expanded={isOpen} aria-controls={`dl-faq-a-${index}`} onClick={() => setOpen(isOpen ? null : index)}>
                      <span className="faq-num">{String(index + 1).padStart(2, '0')}</span>
                      <span className="faq-text">{question}</span>
                      <Plus className="faq-icon" size={22} aria-hidden="true" />
                    </button>
                  </h3>
                  <div className="faq-answer" id={`dl-faq-a-${index}`} role="region" aria-labelledby={`dl-faq-q-${index}`}>
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

function FinalCta() {
  return (
    <section className="dl-section dl-final">
      <div className="shell">
        <Reveal once>
          <div className="dl-final-card">
            {dealerCtaImage && <img className="dl-final-image" src={dealerCtaImage} alt="" loading="lazy" />}
            <div className="dl-orb dl-orb-c" aria-hidden="true" />
            <span className="dl-eyebrow"><i /> Ready when you are</span>
            <h2>Your next buyer has already picked the car. All that’s left is your number.</h2>
            <p>Apply in minutes. Once you’re approved, requests that match your inventory start landing on your dashboard.</p>
            <div className="dl-final-actions">
              <Link className="button dl-btn-light" to="/signup/dealer">Join as a dealer <ArrowRight size={18} /></Link>
              <Link className="button dl-btn-glass" to="/login?role=dealer">Dealer sign in</Link>
            </div>
            <Link className="dl-final-switch" to="/">Looking to buy a car instead? Visit the customer site <ArrowRight size={15} /></Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/** Section id → header link it highlights. The comparison section belongs to "Why dealers". */
const NAV_SECTIONS = { 'dl-how': 'how', 'dl-features': 'why', 'dl-versus': 'why', 'dl-faq': 'faq' };

export default function DealerLandingScreen() {
  useScrollTopOnPush();
  const activeNav = useScrollSpy(NAV_SECTIONS);
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30, restDelta: .001 });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Deal&Drive for Dealers — No more hours on the floor';
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="dl-page">
      <motion.div className="dl-progress" style={{ scaleX: progress }} aria-hidden="true" />
      <header className={`public-header dl-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="shell public-nav">
          <Link to="/" aria-label="Deal&Drive home"><Brand /></Link>
          <nav className="public-nav-links" aria-label="Sections">
            <a {...spyLinkProps(activeNav, 'how')} href="#dl-how">How it works</a>
            <a {...spyLinkProps(activeNav, 'why')} href="#dl-features">Why dealers</a>
            <a {...spyLinkProps(activeNav, 'faq')} href="#dl-faq">FAQ</a>
            <Link className="nav-link" to="/login?role=dealer">Dealer sign in</Link>
          </nav>
          <div className="public-nav-actions">
            <Link className="button button-secondary dl-switch" to="/"><UserRound size={16} /> For customers</Link>
            <Link className="button button-primary" to="/signup/dealer"><span>Join<span className="dl-hide-xs"> as a dealer</span></span> <ArrowRight size={17} /></Link>
          </div>
        </div>
      </header>

      <main>
        <Hero />

        <section className="dl-section dl-how" id="dl-how">
          <div className="shell">
            <SectionHead eyebrow="How It Works" title="Four Steps. Zero Floor Hours.">
              From a buyer’s request to a closed deal, everything happens on one dashboard—no phone tag and no showroom marathons.
            </SectionHead>
            <Timeline />
          </div>
        </section>

        <Features />
        <Versus />
        <GetStarted />
        <DealerFaq />
        <FinalCta />
      </main>

      <footer className="public-footer">
        <div className="shell">
          <span>© 2026 Deal&amp;Drive. Built for confident car buying.</span>
          <span><Link to="/">For customers</Link> · <Link to="/login?role=dealer">Dealer portal</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link></span>
        </div>
      </footer>
    </div>
  );
}
