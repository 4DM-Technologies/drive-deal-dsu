// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MultiSelectDropdown } from './MultiSelectDropdown';

afterEach(cleanup);

const options = [{ value: 'audi', label: 'Audi', hint: '4' }, { value: 'kia', label: 'Kia', hint: '1' }, { value: 'tesla', label: 'Tesla', hint: '2' }];

function Harness() {
  const [values, setValues] = useState<string[]>([]);
  return <MultiSelectDropdown ariaLabel="Filter by brand" allLabel="All brands" values={values} onChange={setValues} options={options} />;
}

const trigger = () => screen.getByRole('combobox', { name: 'Filter by brand' });
const option = (name: RegExp) => screen.getByRole('option', { name });

describe('MultiSelectDropdown', () => {
  it('ticks several options without closing and sums them up on the trigger', () => {
    render(<Harness />);
    expect(trigger().textContent).toBe('All brands');
    fireEvent.click(trigger());
    fireEvent.click(option(/Audi/));
    fireEvent.click(option(/Tesla/));
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(option(/Audi/).getAttribute('aria-selected')).toBe('true');
    expect(option(/All brands/).getAttribute('aria-selected')).toBe('false');
    expect(trigger().textContent).toBe('Audi +1');

    fireEvent.click(option(/Audi/));
    expect(trigger().textContent).toBe('Tesla');
  });

  it('clears the choice from the All row', () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.click(option(/Kia/));
    fireEvent.click(option(/All brands/));
    expect(trigger().textContent).toBe('All brands');
    expect(option(/All brands/).getAttribute('aria-selected')).toBe('true');
  });

  it('works from the keyboard', () => {
    render(<Harness />);
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(trigger().textContent).toBe('Audi');
    fireEvent.keyDown(trigger(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
