import { customAlphabet } from 'nanoid';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const generateID = customAlphabet(alphabet, 16);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Keep infrastructure details out of attendee-facing UI while contract errors
 * remain mapped at the Soroban adapter boundary. */
export function userFacingError(error: unknown, fallback = 'Something went wrong.'): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/reject|declin|cancel/i.test(message)) return 'Wallet request was rejected.';
  if (/network|fetch|rpc|timeout|offline|connection/i.test(message)) return 'Network connection failed.';
  if (/sign.?in|auth|session|otp|callback/i.test(message)) return 'Sign-in could not be completed.';
  if (/sync|mirror|database|supabase/i.test(message)) return 'Ticket synchronization is delayed.';
  if (/status.*unknown|unresolved|still.*check/i.test(message)) return 'Transaction status is still being checked.';
  return fallback;
}
