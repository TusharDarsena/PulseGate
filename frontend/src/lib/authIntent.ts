const STORAGE_KEY = 'stellar-tickets:pending-auth-intent';
const MAX_AGE_MS = 15 * 60 * 1000;

export type ProtectedAction =
  | 'open_checkout'
  | 'open_tickets'
  | 'open_ticket'
  | 'open_account'
  | 'buy_listing'
  | 'open_organizer';

export interface AuthIntent {
  path: string;
  action: ProtectedAction;
  nonce: string;
  createdAt: number;
}

const ACTION_PATHS: Record<ProtectedAction, RegExp> = {
  open_checkout: /^\/events\/[^/?#]+\/checkout(?:\?.*)?$/,
  open_tickets: /^\/tickets(?:\?.*)?$/,
  open_ticket: /^\/tickets\/[^/?#]+(?:\/qr)?(?:\?.*)?$/,
  open_account: /^\/account(?:\?.*)?$/,
  buy_listing: /^\/marketplace\?listing=[^&#]+$/,
  open_organizer: /^\/organizer\/events(?:\/new|\/[^/?#]+(?:\/check-in)?)?(?:\?.*)?$/,
};

export function isValidReturnPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return false;
  try {
    const parsed = new URL(path, window.location.origin);
    if (parsed.origin !== window.location.origin) return false;
    return Object.values(ACTION_PATHS).some((pattern) =>
      pattern.test(`${parsed.pathname}${parsed.search}`),
    );
  } catch {
    return false;
  }
}

export function saveAuthIntent(path: string, action: ProtectedAction): AuthIntent {
  if (!isValidActionPath(path, action)) throw new Error('Unsafe authentication return path.');
  const intent: AuthIntent = {
    path,
    action,
    nonce: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  return intent;
}

export function consumeAuthIntent(expectedNonce?: string): AuthIntent | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as AuthIntent;
    if (!isValidActionPath(intent.path, intent.action)) return null;
    if (!intent.nonce || (expectedNonce && intent.nonce !== expectedNonce)) return null;
    if (!Number.isFinite(intent.createdAt) || Date.now() - intent.createdAt > MAX_AGE_MS) return null;
    return intent;
  } catch {
    return null;
  }
}

export function peekAuthIntent(): AuthIntent | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as AuthIntent;
    if (!isValidActionPath(intent.path, intent.action)) return null;
    if (!intent.nonce || Date.now() - intent.createdAt > MAX_AGE_MS) return null;
    return intent;
  } catch {
    return null;
  }
}

function isValidActionPath(path: string, action: ProtectedAction): boolean {
  if (!isValidReturnPath(path) || !(action in ACTION_PATHS)) return false;
  const parsed = new URL(path, window.location.origin);
  return ACTION_PATHS[action].test(`${parsed.pathname}${parsed.search}`);
}
