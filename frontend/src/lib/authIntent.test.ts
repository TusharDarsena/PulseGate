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
    '/purchases/operation-1',
    '/tickets',
    '/tickets/ticket-1',
    '/tickets/ticket-1/qr',
    '/account',
    '/organizer/events',
    '/organizer/events/new',
    '/organizer/drafts/draft-1',
    '/organizer/events/event-1/check-in',
    '/organizer/events/event-1?operation=operation-1',
  ])('accepts protected application route %s', (path) => {
    expect(isValidReturnPath(path)).toBe(true);
  });

  it.each([
    'https://attacker.example/account',
    '//attacker.example/account',
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

  it('fails soft when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    expect(() => saveAuthIntent('/tickets', 'open_tickets')).not.toThrow();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });
    expect(consumeAuthIntent()).toBeNull();
  });
});
