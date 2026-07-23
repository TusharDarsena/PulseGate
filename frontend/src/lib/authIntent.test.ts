import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  consumeAuthIntent,
  isValidReturnPath,
  saveAuthIntent,
} from './authIntent';

describe('validated authentication return', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it.each([
    '/events/event-1/checkout',
    '/tickets',
    '/tickets/ticket-1',
    '/tickets/ticket-1/qr',
    '/account',
    '/organizer/events/event-1/check-in',
  ])('accepts protected application route %s', (path) => {
    expect(isValidReturnPath(path)).toBe(true);
  });

  it.each([
    'https://attacker.example/account',
    '//attacker.example/account',
    '/purchases/operation-1',
    '/events',
    '/scanner',
    '/account\\@attacker.example',
  ])('rejects unsafe or unreserved route %s', (path) => {
    expect(isValidReturnPath(path)).toBe(false);
  });

  it('binds consumption to the callback nonce and consumes only once', () => {
    const intent = saveAuthIntent('/events/event-1/checkout', 'open_checkout');
    expect(consumeAuthIntent('wrong')).toBeNull();
    expect(consumeAuthIntent(intent.nonce)).toBeNull();

    const next = saveAuthIntent('/tickets', 'open_tickets');
    expect(consumeAuthIntent(next.nonce)?.path).toBe('/tickets');
    expect(consumeAuthIntent(next.nonce)).toBeNull();
  });

  it('rejects a valid route paired with the wrong protected action', () => {
    expect(() => saveAuthIntent('/account', 'open_organizer')).toThrow(
      'Unsafe authentication return path.',
    );
  });
});
