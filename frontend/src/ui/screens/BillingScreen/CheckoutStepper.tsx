import { Check } from 'lucide-react';
import { checkoutSteps } from '@/helpers/checkout';
import type { CheckoutStep } from '@/helpers/checkout';

interface CheckoutStepperProps {
  current: CheckoutStep;
  /** Called when a finished step is chosen to go back and edit it. */
  onGo: (step: CheckoutStep) => void;
}

/** Three steps: finished steps show a check and can be reopened, the current step is highlighted, later steps are muted. */
export function CheckoutStepper({ current, onGo }: CheckoutStepperProps) {
  const at = checkoutSteps.findIndex((step) => step.id === current);
  return (
    <ol className="stepper" aria-label="Checkout progress">
      {checkoutSteps.map((step, index) => {
        // Confirmation is the end of the flow, so it reads as finished rather than still in progress.
        const state = index < at || (current === 'confirmation' && index === at) ? 'done' : index === at ? 'current' : 'todo';
        const body = <><span className="stepper-dot">{state === 'done' ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : index + 1}</span><span className="stepper-label">{step.label}</span></>;
        // Once the payment has gone through there is nothing left to edit.
        const reopenable = state === 'done' && current !== 'confirmation';
        return (
          <li key={step.id} className={`stepper-step ${state}`} aria-current={index === at ? 'step' : undefined}>
            {reopenable ? <button type="button" className="stepper-body" onClick={() => onGo(step.id)}>{body}</button> : <span className="stepper-body">{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}
