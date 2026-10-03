import type { PendingTitleCleanup } from '../utils/titleDeletion';
import { isPendingTitleCleanup } from '../utils/titleDeletion';

const STORAGE_KEY = '@geniuz/admin-title-cleanup/v1';

export type CleanupStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export class TitleCleanupStore {
  constructor(private readonly storage: CleanupStorage) {}

  async load() {
    const raw = await this.storage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error('The saved file-cleanup list is invalid.', { cause: error });
    }
    if (!Array.isArray(parsed) || !parsed.every(isPendingTitleCleanup)) {
      throw new Error('The saved file-cleanup list has an unsupported format.');
    }
    return parsed as PendingTitleCleanup[];
  }

  async save(records: readonly PendingTitleCleanup[]) {
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
}
