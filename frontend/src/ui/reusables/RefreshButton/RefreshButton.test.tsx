// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshButton } from './RefreshButton';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const button = () => screen.getByRole('button', { name: 'Refresh your requests' }) as HTMLButtonElement;
const announcement = () => screen.getByRole('status').textContent;

describe('RefreshButton', () => {
  it('runs the loader once while busy and announces when it finished', async () => {
    let finish: () => void = () => undefined;
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<RefreshButton onRefresh={onRefresh} subject="your requests" />);
    expect(announcement()).toBe('');

    fireEvent.click(button());
    fireEvent.click(button());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBe(true);
    expect(announcement()).toBe('Refreshing…');

    await act(async () => { finish(); });
    expect(button().disabled).toBe(false);
    expect(announcement()).toBe('Updated');
  });

  it('marks itself failed when the refresh fails and lets the user try again', async () => {
    const onRefresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    render(<RefreshButton onRefresh={onRefresh} subject="your requests" />);

    await act(async () => { fireEvent.click(button()); });
    expect(button().className).toContain('is-failed');
    expect(button().title).toBe('Couldn’t refresh. Try again.');

    await act(async () => { fireEvent.click(button()); });
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(button().className).not.toContain('is-failed');
  });
});
