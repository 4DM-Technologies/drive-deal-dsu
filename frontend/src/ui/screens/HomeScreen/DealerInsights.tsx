import { ArrowDown, ArrowUp, BarChart3, ChevronDown, ChevronUp, Eye, MapPin, Minus, RotateCw, Timer, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { dayRange, percent, rate, responseTime, shortDay, visibleRows, weekChange } from '@/helpers/dealerInsights';
import { FRIENDLY_TIMELINE } from '@/helpers/feedFilters';
import { client } from '@/services/platform/client';
import type { DealerAnalytics } from '@/types/domain';

const TOP_ROWS = 6;

/** A small headline number: label, value, and one line that explains it. */
function Kpi({ icon: Icon, label, value, note, trend, noteTitle }: { icon: LucideIcon; label: string; value: string; note: string; trend?: 'up' | 'down' | 'flat'; noteTitle?: string }) {
  const TrendIcon = trend === 'up' ? ArrowUp : trend === 'down' ? ArrowDown : Minus;
  return <div className="insight-kpi"><span className="insight-kpi-label"><Icon size={15} aria-hidden="true" />{label}</span><strong>{value}</strong><small className={trend ? `insight-trend is-${trend}` : undefined} title={noteTitle}>{trend && <TrendIcon size={13} aria-hidden="true" />}{note}</small></div>;
}

interface BarRow { label: string; count: number; highlight?: boolean; tag?: string }

interface BarListProps {
  rows: BarRow[];
  total: number;
  caption: string;
  emptyText: string;
  /** Grey out rows that aren't highlighted, so the highlighted ones (the dealer's own) stand out. */
  highlighting?: boolean;
  /** With more rows than `keep`, the rest are behind "Show all"; highlighted rows always stay visible. */
  keep?: number;
  /** What the rows are, for the "Show all 12 brands" button. */
  noun?: string;
}

/**
 * One measure across categories as horizontal bars, longest first. Every row is named (nothing is folded into an
 * "Other" row) and carries its count and share as text, so the chart never relies on colour or hovering to be read.
 */
function BarList({ rows, total, caption, emptyText, highlighting = false, keep = Infinity, noun = 'rows' }: BarListProps) {
  const [expanded, setExpanded] = useState(false);
  const max = Math.max(1, ...rows.map((row) => row.count));
  if (rows.length === 0 || total === 0) return <p className="insight-empty">{emptyText}</p>;
  const collapsed = visibleRows(rows, keep, (row) => Boolean(row.highlight));
  const shown = expanded ? rows : collapsed;
  const hidden = rows.length - collapsed.length;
  return <>
    <ul className={`insight-bars${highlighting ? ' is-highlighting' : ''}`} aria-hidden="true">
      {shown.map((row) => <li key={row.label} className={row.highlight ? 'is-highlight' : undefined} title={`${row.label}: ${row.count} ${row.count === 1 ? 'request' : 'requests'} (${percent(row.count, total)})`}>
        <span className="insight-bar-label">{row.label}{row.tag && <em>{row.tag}</em>}</span>
        <span className="insight-bar-track"><span className="insight-bar-fill" style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }} /></span>
        <span className="insight-bar-value">{row.count}<small>{percent(row.count, total)}</small></span>
      </li>)}
    </ul>
    {hidden > 0 && <button type="button" className="insight-more" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? <><ChevronUp size={15} aria-hidden="true" /> Show fewer</> : <><ChevronDown size={15} aria-hidden="true" /> Show all {rows.length} {noun}</>}</button>}
    <table className="sr-only"><caption>{caption}</caption><thead><tr><th scope="col">Category</th><th scope="col">Requests</th><th scope="col">Share</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label}><th scope="row">{row.label}{row.tag ? ` (${row.tag})` : ''}</th><td>{row.count}</td><td>{percent(row.count, total)}</td></tr>)}</tbody></table>
  </>;
}

/** New requests per day as columns, with a tooltip on hover or keyboard focus and a table for screen readers. */
function DailyColumns({ days }: { days: DealerAnalytics['dailyNewRequests'] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.count));
  const peak = days.reduce((best, day, index) => (day.count > (days[best]?.count ?? -1) ? index : best), 0);
  const shown = active ?? null;
  return <div className="insight-columns-wrap">
    <div className="insight-columns" role="list" aria-label="New buyer requests per day" onMouseLeave={() => setActive(null)}>
      {days.map((day, index) => <button type="button" role="listitem" key={day.date} className={`insight-column${index === shown ? ' is-active' : ''}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} aria-label={`${shortDay(day.date)}: ${day.count} new ${day.count === 1 ? 'request' : 'requests'}`}>
        {index === peak && day.count > 0 && shown === null && <span className="insight-column-peak">{day.count}</span>}
        <span className="insight-column-bar" style={{ height: day.count ? `${Math.max(6, (day.count / max) * 100)}%` : '2px' }} />
        {index === shown && <span className="insight-tooltip" role="tooltip"><strong>{day.count}</strong> new {day.count === 1 ? 'request' : 'requests'}<small>{shortDay(day.date)}</small></span>}
      </button>)}
    </div>
    <div className="insight-columns-axis" aria-hidden="true"><span>{days[0] ? shortDay(days[0].date) : ''}</span><span>Today</span></div>
  </div>;
}

/** Market insights on the dealer overview: where demand is, what it asks for, and how the dealer's quotes are doing. */
export function DealerInsights() {
  const [data, setData] = useState<DealerAnalytics | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void client.dealer.analytics().then((result) => { if (active) { setData(result); setFailed(false); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  const head = <div className="section-head"><div><span className="eyebrow">Market insights</span><h2>Where buyers are, and how you’re doing</h2></div></div>;
  if (failed && !data) return <section className="card card-pad dealer-insights">{head}<div className="insight-empty insight-error"><span>Market insights couldn’t be loaded.</span><button type="button" className="button button-secondary button-sm" onClick={() => setAttempt((value) => value + 1)}><RotateCw size={14} /> Try again</button></div></section>;
  if (!data) return <section className="card card-pad dealer-insights" aria-busy="true">{head}<div className="insight-loading" aria-label="Loading market insights"><span /><span /><span /><span /></div></section>;

  const { performance: mine } = data;
  const change = weekChange(data.newRequests.last7Days, data.newRequests.previous7Days);
  // "Last week" is the trend's first 7 days and "this week" its last 7; the hover text names them.
  const days = data.dailyNewRequests;
  const weeksTitle = days.length === 14 ? `Last week: ${dayRange(days[0]!.date, days[6]!.date)} · This week: ${dayRange(days[7]!.date, days[13]!.date)}` : undefined;
  const decided = mine.accepted + mine.declined;
  const states: BarRow[] = data.byState.map((row) => ({ label: row.state, count: row.count }));
  const brands: BarRow[] = data.byBrand.map((row) => ({ label: row.brand, count: row.count, highlight: row.mine, ...(row.mine ? { tag: 'Yours' } : {}) }));
  const quietBrands = data.myBrandsWithoutRequests;
  const hasBrands = data.byBrand.some((row) => row.mine) || quietBrands.length > 0;
  const timing = data.byTimeline.map((row) => ({ label: FRIENDLY_TIMELINE[row.timeline] ?? row.timeline, count: row.count }));

  return <section className="card card-pad dealer-insights" aria-labelledby="dealer-insights-title">
    <div className="section-head"><div><span className="eyebrow">Market insights</span><h2 id="dealer-insights-title">Where buyers are, and how you’re doing</h2></div><span className="insight-scope">{data.openRequests} open {data.openRequests === 1 ? 'request' : 'requests'} in the market</span></div>

    <div className="insight-kpis">
      <Kpi icon={BarChart3} label="New requests, last 7 days" value={String(data.newRequests.last7Days)} note={change.text} trend={change.trend} {...(weeksTitle ? { noteTitle: weeksTitle } : {})} />
      <Kpi icon={Trophy} label="Your win rate" value={rate(mine.winRate)} note={decided ? `${mine.accepted} won of ${decided} quotes buyers decided on` : 'No buyer decisions on your quotes yet'} />
      <Kpi icon={Eye} label="Buyers who opened your quotes" value={rate(mine.buyerViewRate)} note={mine.quotesSent ? `Across your ${mine.quotesSent} ${mine.quotesSent === 1 ? 'quote' : 'quotes'}` : 'Send a quote to start tracking'} />
      <Kpi icon={Timer} label="Your typical response time" value={responseTime(mine.medianResponseHours)} note="From a buyer’s request to your quote (median)" />
    </div>

    <div className="insight-grid">
      <article className="insight-card">
        <header><h3>New buyer requests</h3><p>Posted each day over the last 14 days. Hover a day for its count.</p></header>
        <DailyColumns days={data.dailyNewRequests} />
        <table className="sr-only"><caption>New buyer requests per day, last 14 days</caption><thead><tr><th scope="col">Day</th><th scope="col">New requests</th></tr></thead><tbody>{data.dailyNewRequests.map((day) => <tr key={day.date}><th scope="row">{shortDay(day.date)}</th><td>{day.count}</td></tr>)}</tbody></table>
      </article>
      <article className="insight-card">
        <header><h3><MapPin size={15} aria-hidden="true" /> Where buyers are</h3><p>Open requests by the buyer’s state.</p></header>
        <BarList rows={states} total={data.openRequests} caption="Open requests by state" emptyText="No open requests right now." keep={TOP_ROWS} noun="states" />
      </article>
      <article className="insight-card">
        <header><h3>What buyers want</h3><p>Open requests by brand. <span className="insight-key"><i aria-hidden="true" /> Your brands</span> always show.</p></header>
        <BarList rows={brands} total={data.openRequests} caption="Open requests by brand" emptyText="No open requests right now." highlighting keep={TOP_ROWS} noun="brands" />
        {quietBrands.length > 0 && <p className="insight-footnote">No open requests right now for your {quietBrands.length === 1 ? 'brand' : 'brands'}: <strong>{quietBrands.join(', ')}</strong>.</p>}
        {!hasBrands && <p className="insight-footnote">Add the brands you sell on your <Link to="/profiles">profile</Link> to see them highlighted here.</p>}
      </article>
      <article className="insight-card">
        <header><h3>When buyers plan to buy</h3><p>How soon open requests expect to decide.</p></header>
        <BarList rows={timing} total={data.openRequests} caption="Open requests by buying timeline" emptyText="No open requests right now." />
      </article>
    </div>
  </section>;
}
