const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const {
  TRANSFER_CHUNK_BYTES,
  TransferFrameParser,
  base64ToBytes,
  bytesToBase64,
  encodeTransferFrame,
  getTransferChunkCount,
  getTransferChunkSize,
  getTransferResumeBytes,
} = require('../.test-build/src/utils/deviceTransferProtocol.js');

test('transfer framing accepts split frames and rejects malformed or oversized input', () => {
  const parser = new TransferFrameParser();
  const encoded = encodeTransferFrame({
    type: 'resume',
    nextChunk: 2,
    receivedBytes: TRANSFER_CHUNK_BYTES * 2,
  });
  assert.deepEqual(parser.push(encoded.slice(0, 8)), []);
  assert.deepEqual(parser.push(encoded.slice(8)), [{
    type: 'resume',
    nextChunk: 2,
    receivedBytes: TRANSFER_CHUNK_BYTES * 2,
  }]);
  assert.throws(() => parser.push('{"type":"unknown"}\n'), /invalid/i);
  assert.throws(() => parser.push('x'.repeat(400_001)), /too large/i);
});

test('transfer base64 preserves binary chunks including padding boundaries', () => {
  for (const length of [0, 1, 2, 3, 255, 256, TRANSFER_CHUNK_BYTES]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 29) % 256);
    assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  }
  assert.throws(() => base64ToBytes('!!!='), /encoding is invalid/i);
});

test('transfer chunk sizing resumes only on acknowledged chunk boundaries', () => {
  const fileSize = TRANSFER_CHUNK_BYTES * 2 + 31;
  assert.equal(getTransferChunkCount(fileSize), 3);
  assert.equal(getTransferChunkSize(fileSize, 0), TRANSFER_CHUNK_BYTES);
  assert.equal(getTransferChunkSize(fileSize, 2), 31);
  assert.equal(getTransferResumeBytes(fileSize, 2), TRANSFER_CHUNK_BYTES * 2);
  assert.equal(getTransferResumeBytes(fileSize, 3), fileSize);
  assert.throws(() => getTransferChunkSize(fileSize, 3), /chunk index/i);
  assert.throws(() => getTransferChunkCount(0), /file size/i);
});

test('transfer harness resumes after an unacknowledged chunk without duplicating bytes', () => {
  const source = Buffer.from(
    Array.from({ length: TRANSFER_CHUNK_BYTES * 2 + 37 }, (_, index) => index % 251),
  );
  const totalChunks = getTransferChunkCount(source.length);
  const received = [];
  let receiverNextChunk = 0;
  let receiverBytes = 0;

  const deliver = (frame) => {
    const parser = new TransferFrameParser();
    const encoded = encodeTransferFrame(frame);
    const splitAt = Math.floor(encoded.length / 3);
    const decoded = [
      ...parser.push(encoded.slice(0, splitAt)),
      ...parser.push(encoded.slice(splitAt)),
    ][0];
    assert.ok(decoded);
    if (decoded.index < receiverNextChunk) {
      return {
        nextChunk: receiverNextChunk,
        receivedBytes: getTransferResumeBytes(source.length, receiverNextChunk),
      };
    }
    assert.equal(decoded.index, receiverNextChunk);
    const bytes = base64ToBytes(decoded.payload);
    assert.equal(bytes.byteLength, getTransferChunkSize(source.length, decoded.index));
    received.push(Buffer.from(bytes));
    receiverNextChunk += 1;
    receiverBytes += bytes.byteLength;
    return { nextChunk: receiverNextChunk, receivedBytes: receiverBytes };
  };

  const firstChunkSize = getTransferChunkSize(source.length, 0);
  const firstChunk = source.subarray(0, firstChunkSize);
  deliver({
    type: 'chunk',
    index: 0,
    bytes: firstChunkSize,
    payload: bytesToBase64(firstChunk),
  });

  let senderNextChunk = 0;
  while (senderNextChunk < totalChunks) {
    const size = getTransferChunkSize(source.length, senderNextChunk);
    const chunk = source.subarray(
      senderNextChunk * TRANSFER_CHUNK_BYTES,
      senderNextChunk * TRANSFER_CHUNK_BYTES + size,
    );
    const ack = deliver({
      type: 'chunk',
      index: senderNextChunk,
      bytes: size,
      payload: bytesToBase64(chunk),
    });
    senderNextChunk = ack.nextChunk;
    assert.equal(ack.receivedBytes, getTransferResumeBytes(source.length, senderNextChunk));
  }

  const reconstructed = Buffer.concat(received);
  assert.deepEqual(reconstructed, source);
  assert.equal(
    createHash('sha256').update(reconstructed).digest('hex'),
    createHash('sha256').update(source).digest('hex'),
  );
});
