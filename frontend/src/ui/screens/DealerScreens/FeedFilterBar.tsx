import { CarFront, Clock3, MapPin, RotateCcw, Route, Search, Shapes, Tag, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ANY_DISTANCE, DEFAULT_FEED_FILTERS, FRIENDLY_TIMELINE, TIMELINE_ORDER, activeFilterCount, facetOptions, myBrandsCount, updateFeedFilters, type FeedFacet, type FeedFilters, type MyBrandNames } from '@/helpers/feedFilters';
import { Dropdown } from '@/ui/reusables/Dropdown/Dropdown';
import { MultiSelectDropdown } from '@/ui/reusables/Dropdown/MultiSelectDropdown';
import type { BuyerRequest } from '@/types/domain';

const DISTANCES = [{ value: '25', label: '25 miles' }, { value: '50', label: '50 miles' }, { value: '100', label: '100 miles' }, { value: ANY_DISTANCE, label: 'Any distance' }];
/** The "My brands" row in the brand menu; it can't clash with a brand name, which never starts with "__". */
const MY_BRANDS = '__my_brands__';

function Field({ icon: Icon, active, children }: { icon: LucideIcon; active: boolean; children: ReactNode }) {
  return <div className={`feed-filter${active ? ' is-active' : ''}`}><Icon size={15} aria-hidden="true" />{children}</div>;
}

interface FeedFilterBarProps {
  /** The requests open to this dealer, before any filter. */
  requests: readonly BuyerRequest[];
  filters: FeedFilters;
  onChange: (filters: FeedFilters) => void;
  /** Offer "My brands" (dealers). */
  showMyBrands?: boolean;
  /** The brands on the dealer's profile, by name. */
  myBrandNames?: MyBrandNames;
}

/** Search plus a dropdown for each way to narrow the buyer feed: area, car (brand, model, body type), timing and distance. */
export function FeedFilterBar({ requests, filters, onChange, showMyBrands = false, myBrandNames = [] }: FeedFilterBarProps) {
  const set = (patch: Partial<FeedFilters>) => onChange(updateFeedFilters(filters, patch, myBrandNames));
  const counted = (facet: FeedFacet, label: (value: string) => string = (value) => value, order?: readonly string[]) =>
    facetOptions(requests, filters, facet, order, myBrandNames).map(({ value, count }) => ({ value, label: label(value), hint: String(count) }));

  const brandOptions = [
    ...(showMyBrands ? [{ value: MY_BRANDS, label: 'My brands', hint: myBrandNames.length ? String(myBrandsCount(requests, filters, myBrandNames)) : 'none set', dividerAfter: true }] : []),
    ...counted('brand'),
  ];
  const brandValues = [...(filters.myBrands ? [MY_BRANDS] : []), ...filters.brands];
  const setBrands = (values: string[]) => set({ myBrands: values.includes(MY_BRANDS), brands: values.filter((value) => value !== MY_BRANDS) });
  // With exactly one brand ticked, its models are listed without repeating the brand name.
  const singleBrand = filters.brands.length === 1 && !filters.myBrands ? filters.brands[0]! : null;
  const modelLabel = (value: string) => (singleBrand && value.startsWith(`${singleBrand} `) ? value.slice(singleBrand.length + 1) : value);
  const timelineLabel = (value: string) => FRIENDLY_TIMELINE[value as BuyerRequest['timeline']] ?? value;
  const changed = activeFilterCount(filters);

  return <div className="card card-pad feed-toolbar">
    <label className="search-field"><Search size={17} /><input type="search" value={filters.search} onChange={(event) => set({ search: event.target.value })} placeholder="Search cars or areas" aria-label="Search buyer requests" /></label>
    <div className="feed-filters" role="group" aria-label="Filter buyer requests">
      <Field icon={MapPin} active={filters.areas.length > 0}><MultiSelectDropdown ariaLabel="Filter by area" allLabel="All areas" values={filters.areas} onChange={(areas) => set({ areas })} options={counted('area')} /></Field>
      <Field icon={CarFront} active={brandValues.length > 0}><MultiSelectDropdown ariaLabel="Filter by brand" allLabel="All brands" values={brandValues} onChange={setBrands} options={brandOptions} /></Field>
      <Field icon={Tag} active={filters.models.length > 0}><MultiSelectDropdown ariaLabel="Filter by model" allLabel="All models" values={filters.models} onChange={(models) => set({ models })} options={counted('model', modelLabel)} /></Field>
      <Field icon={Shapes} active={filters.bodyTypes.length > 0}><MultiSelectDropdown ariaLabel="Filter by body type" allLabel="All types" values={filters.bodyTypes} onChange={(bodyTypes) => set({ bodyTypes })} options={counted('bodyType')} /></Field>
      <Field icon={Clock3} active={filters.timelines.length > 0}><MultiSelectDropdown ariaLabel="Filter by buying timeline" allLabel="Any timing" align="right" values={filters.timelines} onChange={(timelines) => set({ timelines })} options={counted('timeline', timelineLabel, TIMELINE_ORDER)} /></Field>
      <Field icon={Route} active={filters.distance !== DEFAULT_FEED_FILTERS.distance}><Dropdown ariaLabel="Maximum distance" align="right" value={filters.distance} onChange={(distance) => set({ distance })} options={DISTANCES} /></Field>
    </div>
    <button type="button" className="button button-ghost feed-reset" disabled={changed === 0} onClick={() => onChange({ ...DEFAULT_FEED_FILTERS })} title="Reset filters" aria-label={changed ? `Reset ${changed} ${changed === 1 ? 'filter' : 'filters'}` : 'No filters to reset'}><RotateCcw size={16} /><span className="feed-reset-label">Reset</span>{changed > 0 && <b className="feed-reset-count">{changed}</b>}</button>
  </div>;
}
