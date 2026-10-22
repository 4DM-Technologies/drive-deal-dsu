// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { client } from '@/services/platform/client';
import { ReportUserDialog } from './ReportUserDialog';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const DETAILS = 'They asked me to send a deposit by wire to a personal account.';
const renderDialog = (onClose = vi.fn()) => render(<ReportUserDialog quoteId="quote-1" reportedName="Naveen Motors" reportedRole="dealer" vehicle="Honda Jazz" onClose={onClose} />);
const submit = () => screen.getByRole('button', { name: 'Submit report' }) as HTMLButtonElement;

describe('ReportUserDialog', () => {
  it('offers the reasons that apply to a dealer', () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Report Naveen Motors' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Misleading vehicle, price or fees/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Fake or non-serious buyer/ })).toBeNull();
  });

  it('keeps Submit disabled until a reason, enough detail and the accuracy check are given, then sends the report', async () => {
    const create = vi.spyOn(client.reports, 'create').mockResolvedValue({ id: 'r1', reportId: 'RPT-123456ABCD', status: 'open', evidenceCount: 0, conversationAttached: true, createdAt: '2026-10-23T10:00:00Z' });
    renderDialog();
    expect(submit().disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /Asked for payment outside Deal&Drive/ }));
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: 'Too short' } });
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: DETAILS } });
    expect(submit().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /information I’ve provided is accurate/ }));
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText('RPT-123456ABCD')).toBeTruthy());
    expect(create).toHaveBeenCalledWith({ quoteId: 'quote-1', reason: 'off_platform_payment', details: DETAILS, includeConversation: true, confirmAccurate: true, files: [] });
  });

  it('shows the server’s message when the conversation was already reported', async () => {
    vi.spyOn(client.reports, 'create').mockRejectedValue(new Error('You already reported this conversation and our team is reviewing it (RPT-1).'));
    renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Scam or fraud/ }));
    fireEvent.change(screen.getByLabelText(/What happened/), { target: { value: DETAILS } });
    fireEvent.click(screen.getByRole('checkbox', { name: /accurate/ }));
    fireEvent.click(submit());
    expect((await screen.findByRole('alert')).textContent).toContain('RPT-1');
  });

  it('rejects a PDF and closes on Escape', () => {
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.change(screen.getByLabelText(/Attach screenshots/), { target: { files: [new File(['%PDF'], 'proof.pdf', { type: 'application/pdf' })] } });
    expect(screen.getByRole('alert').textContent).toMatch(/screenshots only/);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
