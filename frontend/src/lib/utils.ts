import { customAlphabet } from 'nanoid';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export const generateID = customAlphabet(alphabet, 16);

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
