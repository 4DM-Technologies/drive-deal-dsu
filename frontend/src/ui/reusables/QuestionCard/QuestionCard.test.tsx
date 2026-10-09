// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuidedQuestion } from '@/types/domain';
import { QuestionCard, type QuestionCardProps } from './QuestionCard';

const question: GuidedQuestion = {
  id: 'variant',
  title: 'Which M3?',
  options: [
    { value: 'v1', label: 'M3 Sedan', description: 'Manual · RWD' },
    { value: 'v2', label: 'M3 Competition Sedan', description: 'Automatic · RWD' },
    { value: 'v3', label: 'M3 Competition M xDrive Sedan', description: 'Automatic · AWD' },
  ],
  allowOther: true,
  otherPlaceholder: 'Something else…',
  multiSelect: false,
  skippable: true,
  index: 1,
  total: 5,
};

function renderCard(overrides: Partial<QuestionCardProps> = {}) {
  const props: QuestionCardProps = {
    question,
    canGoBack: false,
    canGoForward: false,
    onAnswer: vi.fn(),
    onOther: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    onForward: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<QuestionCard {...props} />);
  return props;
}

afterEach(cleanup);

describe('QuestionCard', () => {
  it('shows the question, its position and every option with its description', () => {
    renderCard();
    expect(screen.getByRole('heading', { name: 'Which M3?' })).toBeTruthy();
    expect(screen.getByText('1 of 5')).toBeTruthy();
    expect(screen.getByText('M3 Competition Sedan')).toBeTruthy();
    expect(screen.getByText('Automatic · AWD')).toBeTruthy();
  });

  it('answers with a number key or a click', () => {
    const props = renderCard();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Which M3?' }).closest('section')!, { key: '2' });
    expect(props.onAnswer).toHaveBeenCalledWith(['v2'], ['M3 Competition Sedan']);
    fireEvent.click(screen.getByText('M3 Sedan'));
    expect(props.onAnswer).toHaveBeenLastCalledWith(['v1'], ['M3 Sedan']);
  });

  it('sends typed text, skips, and closes with Escape', () => {
    const props = renderCard();
    const input = screen.getByPlaceholderText('Something else');
    fireEvent.change(input, { target: { value: 'the competition one' } });
    fireEvent.submit(input.closest('form')!);
    expect(props.onOther).toHaveBeenCalledWith('the competition one');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(props.onSkip).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Which M3?' }).closest('section')!, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('collects several choices for a multi-select question', () => {
    const props = renderCard({ question: { ...question, id: 'must_haves', title: 'Any must-haves?', multiSelect: true } });
    fireEvent.click(screen.getByText('M3 Sedan'));
    fireEvent.click(screen.getByText('M3 Competition Sedan'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(props.onAnswer).toHaveBeenCalledWith(['v1', 'v2'], ['M3 Sedan', 'M3 Competition Sedan']);
  });

  it('enables the pager only when there is somewhere to go', () => {
    const props = renderCard({ canGoBack: true });
    const previous = screen.getByRole('button', { name: 'Previous question' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next question' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(false);
    expect(next.disabled).toBe(true);
    fireEvent.click(previous);
    expect(props.onBack).toHaveBeenCalled();
  });

  it('hides Skip for a required question', () => {
    renderCard({ question: { ...question, skippable: false } });
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});
