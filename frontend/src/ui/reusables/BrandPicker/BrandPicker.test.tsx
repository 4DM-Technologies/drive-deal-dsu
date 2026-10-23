// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrandRef } from '@/types/domain';
import { BrandPicker } from './BrandPicker';

afterEach(cleanup);

const brands: BrandRef[] = [{ id: 'ford', name: 'Ford' }, { id: 'bmw', name: 'BMW' }, { id: 'honda', name: 'Honda' }];
// What the picker last reported, recorded from its change callbacks.
const latest = { ids: [] as string[], others: [] as string[] };
afterEach(() => { latest.ids = []; latest.others = []; });

function Harness({ initialIds = [], initialOthers = [] }: { initialIds?: string[]; initialOthers?: string[] }) {
  const [ids, setIds] = useState(initialIds);
  const [others, setOthers] = useState(initialOthers);
  return <BrandPicker id="brands" brands={brands} selectedIds={ids} onSelectedIdsChange={(next) => { latest.ids = next; setIds(next); }} otherBrands={others} onOtherBrandsChange={(next) => { latest.others = next; setOthers(next); }} />;
}

const open = () => fireEvent.click(screen.getByText(/Select the brands you sell|selected/));

describe('BrandPicker', () => {
  it('selects several brands and shows them as removable chips', () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByLabelText('Ford'));
    fireEvent.click(screen.getByLabelText('Honda'));
    expect(latest.ids).toEqual(['ford', 'honda']);
    expect(screen.getByText('2 brands selected')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Ford'));
    expect(latest.ids).toEqual(['honda']);
  });

  it('filters the list by search', () => {
    render(<Harness />);
    open();
    fireEvent.change(screen.getByLabelText('Search brands'), { target: { value: 'bm' } });
    expect(screen.getByLabelText('BMW')).toBeTruthy();
    expect(screen.queryByLabelText('Ford')).toBeNull();
  });

  it('adds a typed brand under Other, and selects the listed brand when the name is already in the list', () => {
    render(<Harness />);
    open();
    fireEvent.click(screen.getByLabelText(/Other, my brand isn’t listed/));
    const input = screen.getByLabelText('Other brand name');
    fireEvent.change(input, { target: { value: 'Rivian' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(latest.others).toEqual(['Rivian']);

    fireEvent.change(input, { target: { value: 'ford' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(latest.ids).toEqual(['ford']);
    expect(latest.others).toEqual(['Rivian']);

    fireEvent.change(input, { target: { value: 'rivian' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('rivian is already added.');
  });

  it('shows brands the dealer already has', () => {
    render(<Harness initialIds={['bmw']} initialOthers={['Polestar']} />);
    expect(screen.getByText('BMW')).toBeTruthy();
    expect(screen.getByText('Polestar')).toBeTruthy();
    expect(screen.getByText('2 brands selected')).toBeTruthy();
  });
});
