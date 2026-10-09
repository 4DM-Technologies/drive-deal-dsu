import { Car, Clock3, MapPin, RotateCcw, Route, Search, Tag, Truck, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ALL, ANY_DISTANCE, DEFAULT_FEED_FILTERS, FRIENDLY_TIMELINE, TIMELINE_ORDER, activeFilterCount, facetOptions, updateFeedFilters, type FeedFacet, type FeedFilters } from '@/helpers/feedFilters';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import type { BuyerRequest } from '@/types/domain';

const DISTANCES = [{ value: '25', label: '25 miles' }, { value: '50', label: '50 miles' }, { value: '100', label: '100 miles' }, { value: ANY_DISTANCE, label: 'Any distance' }];

function Field({ icon: Icon, active, children }: { icon: LucideIcon; active: boolean; children: ReactNode }) {
  return <div className={`feed-filter${active ? ' is-active' : ''}`}><Icon size={15} aria-hidden="true" />{children}</div>;
}

interface FeedFilterBarProps {
  /** The requests open to this dealer, before any filter. */
  requests: readonly BuyerRequest[];
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
}

/** Search plus a dropdown for each way to narrow the buyer feed: area, car (brand, model, body type), timing and distance. */
export function FeedFilterBar({ requests, filters, onChange }: FeedFilterBarProps) {
  const set = (patch: Partial<FeedFilters>) => onChange(updateFeedFilters(filters, patch));
  const choices = (facet: FeedFacet, allLabel: string, label: (value: string) => string = (value) => value, order?: readonly string[]) => [
    { value: ALL, label: allLabel },
    ...facetOptions(requests, filters, facet, order).map(({ value, count }) => ({ value, label: label(value), hint: String(count) })),
  ];
  const modelLabel = (value: string) => (filters.brand === ALL ? value : value.slice(filters.brand.length + 1));
  const changed = activeFilterCount(filters);

  return <div className="card card-pad feed-toolbar">
    <label className="search-field"><Search size={17} /><input type="search" value={filters.search} onChange={(event) => set({ search: event.target.value })} placeholder="Search cars or areas" aria-label="Search buyer requests" /></label>
    <div className="feed-filters" role="group" aria-label="Filter buyer requests">
      <Field icon={MapPin} active={filters.area !== ALL}><Dropdown ariaLabel="Filter by area" align="left" value={filters.area} onChange={(area) => set({ area })} options={choices('area', 'All areas')} /></Field>
      <Field icon={Car} active={filters.brand !== ALL}><Dropdown ariaLabel="Filter by brand" align="left" value={filters.brand} onChange={(brand) => set({ brand })} options={choices('brand', 'All brands')} /></Field>
      <Field icon={Tag} active={filters.model !== ALL}><Dropdown ariaLabel="Filter by model" align="left" value={filters.model} onChange={(model) => set({ model })} options={choices('model', 'All models', modelLabel)} /></Field>
      <Field icon={Truck} active={filters.bodyType !== ALL}><Dropdown ariaLabel="Filter by body type" align="left" value={filters.bodyType} onChange={(bodyType) => set({ bodyType })} options={choices('bodyType', 'All types')} /></Field>
      <Field icon={Clock3} active={filters.timeline !== ALL}><Dropdown ariaLabel="Filter by buying timeline" align="right" value={filters.timeline} onChange={(timeline) => set({ timeline })} options={choices('timeline', 'Any timing', (value) => FRIENDLY_TIMELINE[value as BuyerRequest['timeline']] ?? value, TIMELINE_ORDER)} /></Field>
      <Field icon={Route} active={filters.distance !== DEFAULT_FEED_FILTERS.distance}><Dropdown ariaLabel="Maximum distance" align="right" value={filters.distance} onChange={(distance) => set({ distance })} options={DISTANCES} /></Field>
    </div>
    <button type="button" className="button button-ghost feed-reset" disabled={changed === 0} onClick={() => onChange({ ...DEFAULT_FEED_FILTERS })} title="Reset filters" aria-label={changed ? `Reset ${changed} ${changed === 1 ? 'filter' : 'filters'}` : 'No filters to reset'}><RotateCcw size={16} /><span className="feed-reset-label">Reset</span>{changed > 0 && <b className="feed-reset-count">{changed}</b>}</button>
  </div>;
}
