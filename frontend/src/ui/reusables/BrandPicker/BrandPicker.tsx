import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import { useId, useState } from 'react';
import { addOtherBrand } from '@/helpers/dealerBrands';
import type { BrandRef } from '@/types/domain';

interface BrandPickerProps {
  /** Labelled by the field's own <label htmlFor={id}>. */
  id: string;
  brands: BrandRef[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  /** Brands typed under "Other" because they aren't in the list. */
  otherBrands: string[];
  onOtherBrandsChange: (names: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select for the brands a dealership sells: catalog brands from a searchable checklist, plus brands typed under
 * "Other". Opens inline (not as a floating menu) so it is never clipped inside a card or a multi-step form.
 */
export function BrandPicker({ id, brands, selectedIds, onSelectedIdsChange, otherBrands, onOtherBrandsChange, disabled = false }: BrandPickerProps) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [otherOpen, setOtherOpen] = useState(otherBrands.length > 0);
  const [typed, setTyped] = useState('');
  const [otherError, setOtherError] = useState('');

  const names = new Map(brands.map((brand) => [brand.id, brand.name]));
  const visible = brands.filter((brand) => brand.name.toLowerCase().includes(query.trim().toLowerCase()));
  const count = selectedIds.length + otherBrands.length;

  const toggle = (brandId: string) => onSelectedIdsChange(selectedIds.includes(brandId) ? selectedIds.filter((item) => item !== brandId) : [...selectedIds, brandId]);
  function addTyped() {
    const result = addOtherBrand(typed, brands, otherBrands);
    if (result.kind === 'error') { setOtherError(result.message); return; }
    if (result.kind === 'catalog') { if (!selectedIds.includes(result.brandId)) onSelectedIdsChange([...selectedIds, result.brandId]); }
    else onOtherBrandsChange([...otherBrands, result.name]);
    setTyped('');
    setOtherError('');
  }

  return <div className={`brand-picker${open ? ' is-open' : ''}`}>
    <button id={id} type="button" className="brand-picker-trigger" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)} disabled={disabled}>
      <span>{count ? `${count} ${count === 1 ? 'brand' : 'brands'} selected` : 'Select the brands you sell'}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {count > 0 && <ul className="brand-chips" aria-label="Selected brands">
      {selectedIds.map((brandId) => <li key={brandId}>{names.get(brandId) ?? 'Unavailable brand'}<button type="button" onClick={() => toggle(brandId)} aria-label={`Remove ${names.get(brandId) ?? 'brand'}`} disabled={disabled}><X size={13} /></button></li>)}
      {otherBrands.map((name) => <li key={`other-${name}`} className="is-other">{name}<small>Other</small><button type="button" onClick={() => onOtherBrandsChange(otherBrands.filter((item) => item !== name))} aria-label={`Remove ${name}`} disabled={disabled}><X size={13} /></button></li>)}
    </ul>}
    {open && <div className="brand-picker-panel" id={panelId}>
      <label className="search-field brand-picker-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search brands" aria-label="Search brands" /></label>
      <div className="brand-picker-list" role="group" aria-label="Brands">
        {visible.map((brand) => {
          const checked = selectedIds.includes(brand.id);
          return <label key={brand.id} className={checked ? 'is-checked' : ''}><input type="checkbox" checked={checked} onChange={() => toggle(brand.id)} /><span className="brand-check" aria-hidden="true">{checked && <Check size={12} />}</span>{brand.name}</label>;
        })}
        {visible.length === 0 && <p className="brand-picker-empty">No brand matches “{query.trim()}”. Add it under Other below.</p>}
      </div>
      <div className="brand-picker-other">
        <label className={otherOpen ? 'is-checked' : ''}><input type="checkbox" checked={otherOpen} onChange={(event) => setOtherOpen(event.target.checked)} /><span className="brand-check" aria-hidden="true">{otherOpen && <Check size={12} />}</span>Other, my brand isn’t listed</label>
        {otherOpen && <div className="brand-picker-add">
          <input className="input" value={typed} onChange={(event) => { setTyped(event.target.value); setOtherError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTyped(); } }} placeholder="Type a brand name" aria-label="Other brand name" maxLength={60} />
          <button type="button" className="button button-secondary button-sm" onClick={addTyped} disabled={!typed.trim()}><Plus size={14} /> Add</button>
        </div>}
        {otherError && <span className="field-error" role="alert">{otherError}</span>}
      </div>
      <div className="brand-picker-foot"><button type="button" className="button button-ghost button-sm" onClick={() => setOpen(false)}>Done</button></div>
    </div>}
  </div>;
}
