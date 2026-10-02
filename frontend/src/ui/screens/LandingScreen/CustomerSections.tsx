import { AnimatePresence, motion, useInView, useMotionValueEvent, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import {
  ArrowRight, BadgeCheck, Banknote, Car, Check, Handshake, KeyRound, LockKeyhole, MessageSquareText, RotateCcw, Send, ShieldCheck, Sparkles,
  TriangleAlert, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@/helpers/currency';
import { AnimatedNumber } from '@/ui/reusables/AnimatedNumber/AnimatedNumber';
import { Reveal } from '@/ui/reusables/Reveal/Reveal';
import { SerraLogo } from '@/ui/reusables/SerraLogo/SerraLogo';
import { SpotlightCard } from '@/ui/reusables/SpotlightCard/SpotlightCard';

const EASE = [.16, 1, .3, 1] as const;
const money = (value: number) => formatMoney(Math.round(value));

/* ---------- How it works (cards + scroll-filled rail) ---------- */
export type HowStep = { owner: string; icon: LucideIcon; title: string; body: string };

export function HowSection({ steps }: { steps: HowStep[] }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 88%', 'start 38%'] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: .001 });
  const [reached, setReached] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (progress) => setReached(steps.filter((_, index) => progress >= index / (steps.length - 1) - .02).length));
  const lit = reduceMotion ? steps.length : reached;

  return (
    <section className="section lp-how" id="how">
      <div className="shell">
        <Reveal>
          <div className="section-head">
            <div><span className="eyebrow">How it works</span><h2>Four steps. One winner.</h2></div>
            <p>From posting to picking, everything happens in one place—no showroom marathon and no phone tag.</p>
          </div>
        </Reveal>
        <div ref={ref}>
          <div className="lp-how-rail" aria-hidden="true">
            <div className="lp-how-line"><motion.i style={reduceMotion ? { scaleX: 1 } : { scaleX: fill }} /></div>
            {steps.map(({ title }, index) => <span key={title} className={`lp-how-dot${index < lit ? ' is-lit' : ''}`}>{index < lit ? <Check size={16} /> : index + 1}</span>)}
          </div>
          <div className="how-journey">
            {steps.map(({ owner, icon: Icon, title, body }, index) => (
              <Reveal key={title} className="how-item" delay={index * .08} once>
                <article className="card how-card">
                  <div className="how-card-top"><span className="step-owner">{owner}</span><span className="step-number">{index + 1}</span></div>
                  <div className="how-icon"><Icon size={20} /></div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Sera: animated conversation ---------- */
const draftRows = [
  ['Vehicle', 'SUV · AWD · Blue'],
  ['Budget', 'Up to $45,000'],
  ['Area', 'Frisco, TX · within 50 mi'],
  ['Timeline', 'Within 2 weeks'],
  ['Must-haves', 'Sunroof, Apple CarPlay'],
];
const seraBeats = [500, 1500, 2900, 4400, 5400, 6900];
const seraPoints = [
  'Turn a plain-language chat into a complete, private request',
  'Compare itemized dealer offers side by side',
  'Get answers about specific cars grounded in real data',
  'Approve every request before a single dealer sees it',
];

function Bubble({ from, children }: { from: 'user' | 'sera'; children: ReactNode }) {
  return (
    <motion.div className={`lp-bubble is-${from}`} initial={{ opacity: 0, y: 18, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .5, ease: EASE }}>
      {children}
    </motion.div>
  );
}

function Typing() {
  return (
    <motion.div className="lp-bubble is-sera lp-typing" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }} aria-label="Sera is typing">
      <i /><i /><i />
    </motion.div>
  );
}

function SeraChat() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -20% 0px' });
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timers = seraBeats.map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [inView, reduceMotion, run]);

  const current = reduceMotion ? seraBeats.length : step;
  const replay = () => { setStep(0); setRun((value) => value + 1); };

  return (
    <div className="lp-chat" ref={ref}>
      <div className="lp-chat-head">
        <SerraLogo size={40} title={null} />
        <div><strong>Sera</strong><small>Your buyer-side car advisor</small></div>
        <span className="lp-online"><i /> Online</span>
      </div>
      <div className="lp-chat-body" aria-live="polite">
        {current >= 1 && <Bubble from="user">I want a blue SUV, AWD, under $45k. I’m near Frisco, TX.</Bubble>}
        {current === 2 && <Typing />}
        {current >= 3 && <Bubble from="sera">Great start. Any must-haves, like a sunroof or Apple CarPlay? And when do you need it?</Bubble>}
        {current >= 4 && <Bubble from="user">Sunroof and CarPlay. Within two weeks.</Bubble>}
        {current === 5 && <Typing />}
        {current >= 6 && (
          <Bubble from="sera">
            <span>Here’s your request. Review it, edit anything, and I’ll send it to dealers near you.</span>
            <div className="lp-draft">
              <div className="lp-draft-head"><Sparkles size={14} /> Request draft</div>
              {draftRows.map(([label, value], index) => (
                <motion.div key={label} initial={reduceMotion ? false : { opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .4, delay: .25 + index * .09, ease: EASE }}>
                  <span>{label}</span><b>{value}</b>
                </motion.div>
              ))}
              <div className="lp-draft-actions"><span className="is-primary">Approve &amp; send</span><span>Edit</span></div>
              <p><ShieldCheck size={13} /> Nothing is sent until you approve.</p>
            </div>
          </Bubble>
        )}
      </div>
      <div className="lp-chat-foot">
        <span>Ask about a car, an offer, or a deal…</span>
        {current >= 6 && !reduceMotion && <button type="button" onClick={replay}><RotateCcw size={14} /> Replay</button>}
      </div>
    </div>
  );
}

export function SeraSection() {
  return (
    <section className="lp-section lp-sera" id="sera">
      <div className="lp-orb lp-orb-a" aria-hidden="true" />
      <div className="lp-orb lp-orb-b" aria-hidden="true" />
      <div className="shell lp-split">
        <div className="lp-split-copy">
          <Reveal from="left" once>
            <span className="eyebrow">Meet Sera</span>
            <h2>Describe your dream car. Sera builds the request.</h2>
            <p className="lp-lead">Chat in plain language. Sera asks the right questions, then drafts a complete request for you to review. Nothing goes out until you say so.</p>
          </Reveal>
          <ul className="lp-checks">
            {seraPoints.map((point, index) => (
              <motion.li key={point} initial={{ opacity: 0, x: -48 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .6 }} transition={{ duration: .7, delay: index * .09, ease: EASE }}>
                <span><Check size={14} /></span>{point}
              </motion.li>
            ))}
          </ul>
          <Reveal from="left" once delay={.4}>
            <Link className="button button-primary lp-cta" to="/signup/buyer">Start with Sera <ArrowRight size={17} /></Link>
          </Reveal>
        </div>
        <Reveal from="right" once className="lp-split-visual">
          <SeraChat />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Compare like for like (interactive) ---------- */
type Mode = 'ad' | 'otd';
const sampleQuotes = [
  { id: 'northgate', name: 'Northgate Auto', price: 34400, doc: 1450, title: 350 },
  { id: 'lakeshore', name: 'Lakeshore Motors', price: 35000, doc: 650, title: 225 },
  { id: 'premier', name: 'Premier Cars', price: 35300, doc: 150, title: 203 },
].map((quote) => {
  const tax = Math.round(quote.price * .0625);
  return { ...quote, tax, total: quote.price + tax + quote.doc + quote.title };
});
const adLeader = sampleQuotes.reduce((best, quote) => (quote.price < best.price ? quote : best));
const otdLeader = sampleQuotes.reduce((best, quote) => (quote.total < best.total ? quote : best));
const savings = adLeader.total - otdLeader.total;
const included = ['Vehicle price', 'Sales tax', 'Title & licence', 'Dealer doc fee', 'Trade-in credit'];

function QuoteCompare() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -25% 0px' });
  const [mode, setMode] = useState<Mode>('ad');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!inView || touched) return;
    const timer = window.setTimeout(() => setMode('otd'), 2400);
    return () => window.clearTimeout(timer);
  }, [inView, touched]);

  const choose = (next: Mode) => { setTouched(true); setMode(next); };
  const otd = mode === 'otd';
  const sorted = [...sampleQuotes].sort((a, b) => (otd ? a.total - b.total : a.price - b.price));

  return (
    <div className="lp-compare" ref={ref}>
      <div className="lp-seg" role="group" aria-label="Price view">
        {([['ad', 'Advertised price'], ['otd', 'Out-the-door total']] as const).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={mode === key} className={mode === key ? 'is-active' : ''} onClick={() => choose(key)}>
            {mode === key && <motion.span layoutId="lp-seg-pill" className="lp-seg-pill" transition={{ type: 'spring', stiffness: 380, damping: 32 }} />}
            <span>{label}</span>
          </button>
        ))}
      </div>
      <ol className="lp-qlist">
        {sorted.map((quote, index) => {
          const leader = index === 0;
          return (
            <motion.li key={quote.id} layout={reduceMotion ? false : 'position'} transition={{ type: 'spring', stiffness: 260, damping: 30 }} className={`lp-quote${leader ? ' is-leader' : ''}`}>
              <span className="lp-rank">{index + 1}</span>
              <div className="lp-quote-main">
                <div className="lp-quote-name"><strong>{quote.name}</strong><BadgeCheck size={15} aria-label="Verified dealer" /></div>
                <div className="lp-quote-chips">
                  <span>Vehicle {money(quote.price)}</span>
                  <span className={otd ? '' : 'is-off'}>Tax {money(quote.tax)}</span>
                  <span className={otd ? '' : 'is-off'}>Title {money(quote.title)}</span>
                  <span className={otd ? '' : 'is-off'}>Doc fee {money(quote.doc)}</span>
                </div>
              </div>
              <div className="lp-quote-total">
                <b><AnimatedNumber value={otd ? quote.total : quote.price} format={money} active={inView} /></b>
                <small>{otd ? 'out-the-door' : 'advertised'}</small>
                {leader && <span className={`lp-pill ${otd ? 'is-good' : 'is-warn'}`}>{otd ? 'Lowest total' : 'Looks cheapest'}</span>}
              </div>
            </motion.li>
          );
        })}
      </ol>
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={mode} className={`lp-callout ${otd ? 'is-good' : 'is-warn'}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: .25 }}>
          {otd
            ? <><Check size={17} /><span>{otdLeader.name} is {money(savings)} cheaper than the “cheapest” sticker once everything is counted.</span></>
            : <><TriangleAlert size={17} /><span>{adLeader.name} looks cheapest, but its {money(adLeader.doc)} doc fee, tax and title aren’t counted yet.</span></>}
        </motion.p>
      </AnimatePresence>
      <p className="lp-sample">Sample quotes for illustration. Tap a view to compare.</p>
    </div>
  );
}

export function CompareSection() {
  return (
    <section className="lp-section lp-compare-section" id="compare">
      <div className="shell lp-split">
        <div className="lp-split-copy">
          <Reveal from="left" once>
            <span className="eyebrow">Compare like for like</span>
            <h2>The sticker price isn’t the price.</h2>
            <p className="lp-lead lp-lead-light">Teaser prices leave out tax, title, licence and fees. Deal&amp;Drive ranks every offer by what you’ll actually pay to drive away, so the cheapest quote really is the cheapest.</p>
          </Reveal>
          <Reveal from="left" once delay={.12}>
            <div className="lp-included">
              <strong>Every quote itemizes</strong>
              <ul>{included.map((item, index) => <motion.li key={item} initial={{ opacity: 0, scale: .85 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: .5 }} transition={{ duration: .45, delay: .1 + index * .07, ease: EASE }}><Check size={13} />{item}</motion.li>)}</ul>
            </div>
          </Reveal>
          <Reveal from="left" once delay={.2}>
            <Link className="button button-primary lp-cta" to="/signup/buyer">Build my request <ArrowRight size={17} /></Link>
          </Reveal>
        </div>
        <Reveal from="right" once className="lp-split-visual">
          <QuoteCompare />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Benefits bento ---------- */
function FreeVisual() {
  const rows = ['Post your request', 'Receive and compare quotes', 'Negotiate and chat with Sera'];
  return (
    <div className="lp-free">
      {rows.map((row, index) => (
        <motion.div key={row} initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .8 }} transition={{ duration: .6, delay: .1 + index * .12, ease: EASE }}>
          <span><Check size={14} /></span><em>{row}</em><b>$0</b>
        </motion.div>
      ))}
    </div>
  );
}

function PrivacyVisual() {
  const seen = ['The car you want', 'Your target price', 'How far you’ll travel'];
  const hidden = ['Your name', 'Your phone number', 'Your email'];
  return (
    <div className="lp-privacy">
      {[{ label: 'Dealers see', items: seen, show: true }, { label: 'Dealers never see', items: hidden, show: false }].map(({ label, items, show }, column) => (
        <div key={label}>
          <span className={`lp-priv-label ${show ? 'is-see' : 'is-hide'}`}>{label}</span>
          <ul>
            {items.map((item, index) => (
              <motion.li key={item} initial={{ opacity: 0, y: 14 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .9 }} transition={{ duration: .5, delay: .1 + column * .25 + index * .09, ease: EASE }}>
                {show ? <Check size={14} /> : <LockKeyhole size={14} />}{item}
              </motion.li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function NegotiateVisual() {
  const lines = [
    { from: 'you', text: 'Can you get closer to $37,500 out the door?' },
    { from: 'dealer', text: 'Let me revise the quote. One moment.' },
    { from: 'dealer', text: 'Updated: $37,410 out the door.' },
  ] as const;
  return (
    <div className="lp-neg">
      {lines.map(({ from, text }, index) => (
        <motion.p key={text} className={`is-${from}`} initial={{ opacity: 0, y: 14, scale: .95 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} viewport={{ once: true, amount: .9 }} transition={{ duration: .5, delay: .1 + index * .35, ease: EASE }}>
          {text}
        </motion.p>
      ))}
    </div>
  );
}

function TradeVisual() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  return (
    <div className="lp-trade" ref={ref}>
      <div><span>Out-the-door offer</span><b>{money(otdLeader.total)}</b></div>
      <div className="is-credit"><span>Trade-in credit</span><b>−{money(2500)}</b></div>
      <div className="is-final"><span>Your final number</span><b><AnimatedNumber value={otdLeader.total - 2500} format={money} active={inView} /></b></div>
    </div>
  );
}

function VerifiedVisual() {
  const checks = ['Dealership licence on file', 'Reviewed by our support team', 'Approved before they can quote'];
  return (
    <ul className="lp-verified">
      {checks.map((item, index) => (
        <motion.li key={item} initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .9 }} transition={{ duration: .55, delay: .1 + index * .12, ease: EASE }}>
          <ShieldCheck size={16} />{item}
        </motion.li>
      ))}
    </ul>
  );
}

const boardNames = { northgate: 'Northgate Auto', lakeshore: 'Lakeshore Motors', premier: 'Premier Cars' } as const;
const boardStart = { northgate: 38350, lakeshore: 38063, premier: 37859, note: 'Quotes are in. Premier Cars is leading.' };
const boardFrames = [
  boardStart,
  { northgate: 38350, lakeshore: 37690, premier: 37859, note: 'Lakeshore Motors revised their quote.' },
  { northgate: 37540, lakeshore: 37690, premier: 37859, note: 'Northgate Auto revised their quote.' },
  { northgate: 37540, lakeshore: 37690, premier: 37410, note: 'Premier Cars revised their quote.' },
];

function LiveBoard() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '0px 0px -10% 0px' });
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % boardFrames.length), 2800);
    return () => window.clearInterval(timer);
  }, [inView, reduceMotion]);

  const current = boardFrames[frame] ?? boardStart;
  const rows = (Object.keys(boardNames) as (keyof typeof boardNames)[])
    .map((id) => ({ id, name: boardNames[id], price: current[id] }))
    .sort((a, b) => a.price - b.price);

  return (
    <div className="lp-board" ref={ref}>
      <div className="lp-board-head"><span className="lp-live"><i /> Live offers</span><small>Sample</small></div>
      {rows.map((row, index) => (
        <motion.div key={row.id} layout={reduceMotion ? false : 'position'} transition={{ type: 'spring', stiffness: 260, damping: 30 }} className={`lp-board-row${index === 0 ? ' is-leader' : ''}`}>
          <span className="lp-rank">{index + 1}</span>
          <strong>{row.name}</strong>
          {index === 0 && <span className="lp-pill is-good">Leading</span>}
          <b><AnimatedNumber value={row.price} format={money} active={inView} /></b>
        </motion.div>
      ))}
      <AnimatePresence mode="wait" initial={false}>
        <motion.p key={frame} className="lp-board-note" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .25 }}>{current.note}</motion.p>
      </AnimatePresence>
    </div>
  );
}

export function BenefitsSection() {
  return (
    <section className="lp-section lp-benefits" id="benefits">
      <div className="shell">
        <Reveal>
          <div className="lp-head">
            <span className="eyebrow">Built around you</span>
            <h2>Everything on your side of the table.</h2>
            <p>Every feature exists to give the buyer clarity, leverage and peace of mind.</p>
          </div>
        </Reveal>
        <div className="lp-bento">
          <Reveal from="left" once className="lp-b-wide">
            <SpotlightCard className="lp-card">
              <span className="lp-card-icon"><Banknote size={21} /></span>
              <h3>Free, start to finish</h3>
              <p>It never costs you a cent. Dealers pay only when a deal closes, so they’re rewarded for winning your business with a competitive offer, not for chasing you.</p>
              <FreeVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="right" once className="lp-b-narrow">
            <SpotlightCard className="lp-card">
              <span className="lp-card-icon"><LockKeyhole size={21} /></span>
              <h3>Private until you choose</h3>
              <p>Your details are shared only once you accept a quote.</p>
              <PrivacyVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="left" once className="lp-b-third">
            <SpotlightCard className="lp-card">
              <span className="lp-card-icon"><MessageSquareText size={21} /></span>
              <h3>Negotiate in-platform</h3>
              <p>Chat with any dealer about their quote and keep the whole conversation in one place.</p>
              <NegotiateVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal once delay={.08} className="lp-b-third">
            <SpotlightCard className="lp-card">
              <span className="lp-card-icon"><Car size={21} /></span>
              <h3>Trade-in and financing, one number</h3>
              <p>Add them to your request and every dealer folds them into a single total.</p>
              <TradeVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal from="right" once className="lp-b-third">
            <SpotlightCard className="lp-card">
              <span className="lp-card-icon"><ShieldCheck size={21} /></span>
              <h3>Verified dealers only</h3>
              <p>Only approved dealerships can see your request or send you a quote.</p>
              <VerifiedVisual />
            </SpotlightCard>
          </Reveal>
          <Reveal once className="lp-b-full">
            <SpotlightCard className="lp-card lp-card-dark">
              <div className="lp-board-layout">
                <div>
                  <span className="lp-card-icon"><Handshake size={21} /></span>
                  <h3>Offers that re-rank in real time</h3>
                  <p>When a dealer revises their price, your leaderboard updates instantly. No refreshing, no phone tag, just the best total at the top.</p>
                </div>
                <LiveBoard />
              </div>
            </SpotlightCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- From yes to keys: scroll-driven deal tracker ---------- */
const stages = [
  { icon: Send, title: 'Post a request', body: 'Tell dealers the car, budget and timeframe, or let Sera build the request with you. Your details stay private.' },
  { icon: BadgeCheck, title: 'Quote accepted', body: 'Compare itemized offers and accept the one you like. Only you can accept, and your dealer’s contact details unlock.' },
  { icon: MessageSquareText, title: 'Chat process', body: 'Talk it through in the platform. Confirm the paperwork, payment and delivery timing, and watch the order status update.' },
  { icon: Handshake, title: 'Meet in person', body: 'Meet your dealer to finalize the deal in person, with their full contact details in hand.' },
  { icon: KeyRound, title: 'Deal closed', body: 'You confirm receipt, the deal is marked complete, and the keys are yours.' },
];

export function JourneySection() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 78%', 'end 62%'] });
  const fill = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: .001 });
  const carLeft = useTransform(fill, (value) => `${value * 100}%`);
  const [reached, setReached] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (progress) => setReached(stages.filter((_, index) => progress >= index / (stages.length - 1) - .03).length));
  const lit = reduceMotion ? stages.length : reached;

  return (
    <section className="lp-section lp-journey" id="journey">
      <div className="lp-orb lp-orb-c" aria-hidden="true" />
      <div className="shell">
        <Reveal>
          <div className="lp-head is-dark">
            <span className="eyebrow">The full journey</span>
            <h2>From request to keys, every step visible.</h2>
            <p>Post once, pick your offer, chat with your dealer, meet in person, and close the deal, with every stage tracked along the way.</p>
          </div>
        </Reveal>
        <div className="lp-journey-body" ref={ref} style={{ '--n': stages.length } as CSSProperties}>
          <div className="lp-track" aria-hidden="true">
            <div className="lp-track-line"><motion.i style={reduceMotion ? { scaleX: 1 } : { scaleX: fill }} /></div>
            {!reduceMotion && <motion.span className="lp-track-car" style={{ left: carLeft }}><Car size={18} /></motion.span>}
          </div>
          <ol className="lp-stages">
            {stages.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className={index < lit ? 'is-reached' : ''}>
                <Reveal from="up" once delay={index * .07} className="lp-stage">
                  <span className="lp-stage-dot"><Icon size={19} /></span>
                  <div><h3>{title}</h3><p>{body}</p></div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
