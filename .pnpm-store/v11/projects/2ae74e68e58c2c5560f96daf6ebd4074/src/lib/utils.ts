import { customAlphabet } from 'nanoid';
import BigNumber from 'bignumber.js';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard alphanumeric alphabet (no hyphens or underscores)
// Prevents Soroban Symbol crashes and ensures compact IDs.
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generates a strictly alphanumeric ID for events and tickets.
 * Length 16 provides ~10^28 combinations, sufficient for ticketing.
 */
export const generateID = customAlphabet(alphabet, 16);

/**
 * Converts XLM to stroops (1 XLM = 10,000,000 stroops).
 * Using BigNumber prevents IEEE 754 precision drift.
 */
export const toStroops = (xlm: string | number): string => {
  return new BigNumber(xlm).times(10_000_000).toFixed(0, 0);
};

/**
 * Converts stroops to XLM, formatted to 7 decimal places.
 * Using BigNumber prevents IEEE 754 precision drift.
 */
export const toXlm = (stroops: string | number): string => {
  return new BigNumber(stroops).div(10_000_000).toFixed(7, 1);
};

/**
 * Converts an HTML datetime-local input (local time) to UTC Unix timestamp (seconds).
 * Used when creating events — Soroban expects strict UTC.
 */
export const localDateTimeToUtcUnix = (dateTimeLocal: string): number => {
  const date = new Date(dateTimeLocal);
  return Math.floor(date.getTime() / 1000);
};

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
