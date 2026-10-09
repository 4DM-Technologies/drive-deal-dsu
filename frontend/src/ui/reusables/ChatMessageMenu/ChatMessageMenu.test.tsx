// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatMessageMenu } from './ChatMessageMenu';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dots = () => screen.getByRole('button', { name: 'Message actions' });

describe('ChatMessageMenu', () => {
  it('stays closed until the dots are clicked, then offers Edit and Unsend', () => {
    render(<ChatMessageMenu onEdit={vi.fn()} onUnsend={vi.fn()} />);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(dots().getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(dots());
    expect(dots().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Edit', 'Unsend']);
  });

  it('runs Edit and closes the menu', () => {
    const onEdit = vi.fn();
    const onUnsend = vi.fn();
    render(<ChatMessageMenu onEdit={onEdit} onUnsend={onUnsend} />);
    fireEvent.click(dots());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));

    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onUnsend).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('runs Unsend and closes the menu', () => {
    const onUnsend = vi.fn();
    render(<ChatMessageMenu onEdit={vi.fn()} onUnsend={onUnsend} />);
    fireEvent.click(dots());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unsend' }));

    expect(onUnsend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('focuses the first action on open, moves with the arrow keys, and wraps', () => {
    render(<ChatMessageMenu onEdit={vi.fn()} onUnsend={vi.fn()} />);
    fireEvent.click(dots());
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    const unsend = screen.getByRole('menuitem', { name: 'Unsend' });
    expect(document.activeElement).toBe(edit);

    fireEvent.keyDown(edit, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(unsend);
    fireEvent.keyDown(unsend, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(edit);
    fireEvent.keyDown(edit, { key: 'End' });
    expect(document.activeElement).toBe(unsend);
  });

  it('closes on Escape and puts focus back on the dots', () => {
    render(<ChatMessageMenu onEdit={vi.fn()} onUnsend={vi.fn()} />);
    fireEvent.click(dots());
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit' }), { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(dots());
  });

  it('closes when the buyer presses anywhere outside it', () => {
    render(<ChatMessageMenu onEdit={vi.fn()} onUnsend={vi.fn()} />);
    fireEvent.click(dots());
    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens upward when the message is near the bottom of the thread, downward otherwise', () => {
    const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    const place = (triggerRect: DOMRect) => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('chat-scroll') ? rect(100, 600) : triggerRect;
      });
      const { unmount } = render(<div className="chat-scroll"><ChatMessageMenu onEdit={vi.fn()} onUnsend={vi.fn()} /></div>);
      fireEvent.click(dots());
      const upward = screen.getByRole('menu').classList.contains('place-up');
      unmount();
      return upward;
    };

    expect(place(rect(560, 586))).toBe(true);  // 14px of thread left below the dots: no room, plenty above
    expect(place(rect(200, 226))).toBe(false); // 374px below
    expect(place(rect(104, 130))).toBe(false); // close to the top and the bottom has room, so stay downward
  });
});
