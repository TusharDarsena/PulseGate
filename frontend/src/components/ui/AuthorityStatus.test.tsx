import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthorityStatus, type AuthorityStatusState } from './AuthorityStatus';

describe('AuthorityStatus', () => {
  afterEach(cleanup);

  it.each([
    ['checking', 'Checking current state on Stellar…'],
    ['confirmed', 'Current state confirmed on Stellar.'],
    ['unavailable', 'Stellar verification is unavailable.'],
    ['historical', 'Confirmed by a recorded Stellar contract event or receipt.'],
  ] satisfies [AuthorityStatusState, string][])(
    'renders the %s authority state',
    (state, expectedText) => {
      const { container } = render(<AuthorityStatus state={state} />);

      expect(screen.getByRole('status')).toHaveTextContent(expectedText);
      expect(container.querySelector(`[data-authority-state="${state}"]`)).toBeInTheDocument();
    },
  );

  it('uses a screen-specific confirmed statement when supplied', () => {
    render(
      <AuthorityStatus
        state="confirmed"
        message="Current ticket owner and Active status are confirmed on Stellar."
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Current ticket owner and Active status are confirmed on Stellar.',
    );
  });
});
