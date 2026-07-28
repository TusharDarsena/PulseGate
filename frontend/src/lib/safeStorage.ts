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
): boolean {
  try {
    window[storageKind].setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeStorageRemove(storageKind: StorageKind, key: string): boolean {
  try {
    window[storageKind].removeItem(key);
    return true;
  } catch {
    return false;
  }
}
