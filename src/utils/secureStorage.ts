export type SecureKeyValueStore = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

const CHUNK_MARKER = '@geniuz-secure-chunks:v1:';
const CHUNK_KEY_SUFFIX = ':secure-chunk:';
const MAX_CHUNK_BYTES = 1800;
const MAX_CHUNKS = 1024;

export function sanitizeSecureStoreKey(key: string) {
  const sanitized = key.replace(/[^A-Za-z0-9._-]/g, '_');
  return sanitized || 'secure-store-key';
}

function getUtf8Length(value: string) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

export function splitSecureValue(value: string, maxBytes = MAX_CHUNK_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) {
    throw new RangeError('Secure storage chunks must allow at least four bytes.');
  }
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of value) {
    const characterBytes = getUtf8Length(character);
    if (current && currentBytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current || !chunks.length) {
    chunks.push(current);
  }
  return chunks;
}

function chunkCount(value: string | null) {
  if (!value?.startsWith(CHUNK_MARKER)) {
    return 0;
  }
  const count = Number(value.slice(CHUNK_MARKER.length));
  return Number.isSafeInteger(count) && count > 0 && count <= MAX_CHUNKS ? count : -1;
}

export function createChunkedSecureStorage(store: SecureKeyValueStore, maxBytes = MAX_CHUNK_BYTES) {
  const secureStore: SecureKeyValueStore = {
    getItemAsync: (key) => store.getItemAsync(sanitizeSecureStoreKey(key)),
    setItemAsync: (key, value) => store.setItemAsync(sanitizeSecureStoreKey(key), value),
    deleteItemAsync: (key) => store.deleteItemAsync(sanitizeSecureStoreKey(key)),
  };

  return {
    async getItem(key: string) {
      const stored = await secureStore.getItemAsync(key);
      const count = chunkCount(stored);
      if (count === 0) {
        return stored;
      }
      if (count < 0) {
        return null;
      }
      const parts = await Promise.all(
        Array.from({ length: count }, (_, index) =>
          secureStore.getItemAsync(`${key}${CHUNK_KEY_SUFFIX}${index}`),
        ),
      );
      return parts.every((part): part is string => part !== null) ? parts.join('') : null;
    },
    async setItem(key: string, value: string) {
      const priorCount = chunkCount(await secureStore.getItemAsync(key));
      const chunks = splitSecureValue(value, maxBytes);
      const storeInline = chunks.length === 1 && getUtf8Length(value) <= maxBytes;
      if (storeInline) {
        await secureStore.setItemAsync(key, value);
      } else {
        if (chunks.length > MAX_CHUNKS) {
          throw new RangeError('Secure storage value exceeds the supported size.');
        }
        await Promise.all(
          chunks.map((chunk, index) =>
            secureStore.setItemAsync(`${key}${CHUNK_KEY_SUFFIX}${index}`, chunk),
          ),
        );
        await secureStore.setItemAsync(key, `${CHUNK_MARKER}${chunks.length}`);
      }
      const nextChunkCount = storeInline ? 0 : chunks.length;
      if (priorCount > nextChunkCount) {
        await Promise.all(
          Array.from({ length: priorCount - nextChunkCount }, (_, offset) =>
            secureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${nextChunkCount + offset}`),
          ),
        );
      }
    },
    async removeItem(key: string) {
      const count = chunkCount(await secureStore.getItemAsync(key));
      await secureStore.deleteItemAsync(key);
      if (count > 0) {
        await Promise.all(
          Array.from({ length: count }, (_, index) =>
            secureStore.deleteItemAsync(`${key}${CHUNK_KEY_SUFFIX}${index}`),
          ),
        );
      }
    },
  };
}
