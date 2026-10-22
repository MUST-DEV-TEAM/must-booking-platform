import type { StorageProvider as DomainStorageProvider } from '@must/domain-contracts';
export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
export interface StorageProvider extends DomainStorageProvider {
  newObjectKey?(key: string): string;
}
export const uploadObjectKey = (storage: StorageProvider, key: string) =>
  storage.newObjectKey?.(key) ?? key;
