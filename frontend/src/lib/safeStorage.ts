export type StorageKind = 'localStorage' | 'sessionStorage';

export function safeStorageGet(storageKind: StorageKind, key: string): string | null {
  try {
    return window[storageKind].getItem(key);
  } catch {
    return null;
  }
}

export function safeStorageSet(
  storageKind: StorageKind,
  key: string,
  value: string,
): void {
  try {
    window[storageKind].setItem(key, value);
  } catch {
    // Browser storage is optional persistence and must not interrupt the caller.
  }
}

export function safeStorageRemove(storageKind: StorageKind, key: string): void {
  try {
    window[storageKind].removeItem(key);
  } catch {
    // Browser storage is optional persistence and must not interrupt the caller.
  }
}
