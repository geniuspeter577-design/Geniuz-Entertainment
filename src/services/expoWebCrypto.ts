import * as ExpoCrypto from 'expo-crypto';

const existingCrypto = globalThis.crypto;

if (typeof existingCrypto?.subtle?.digest !== 'function') {
  const subtle = {
    digest(algorithm: AlgorithmIdentifier, data: BufferSource) {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
      if (name.toUpperCase().replace(/-/g, '') !== 'SHA256') {
        throw new Error(`Unsupported WebCrypto digest algorithm: ${name}`);
      }
      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, data);
    },
  } as SubtleCrypto;

  const cryptoProvider = {
    getRandomValues: existingCrypto?.getRandomValues?.bind(existingCrypto)
      ?? ExpoCrypto.getRandomValues.bind(ExpoCrypto),
    randomUUID: existingCrypto?.randomUUID?.bind(existingCrypto)
      ?? ExpoCrypto.randomUUID,
    subtle,
  } as unknown as Crypto;

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: cryptoProvider,
  });
}