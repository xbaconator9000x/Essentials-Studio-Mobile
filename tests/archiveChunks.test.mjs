import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHIVE_CHUNK_BYTES,
  MAX_ARCHIVE_BYTES,
  validateArchiveSize,
  expectedArchiveChunkLength,
  encodeArchiveChunk,
  decodeArchiveChunk,
  verifyImportChunkAcknowledgement,
} from "../src/services/archiveChunks.ts";

test("binary upload/export framing preserves every byte, including 0 and 255", () => {
  for (const size of [1, 2, 3, 4, 255, 1025, ARCHIVE_CHUNK_BYTES - 1, ARCHIVE_CHUNK_BYTES]) {
    const original = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 255) % 256);
    const encoded = encodeArchiveChunk(original);
    assert.deepEqual(decodeArchiveChunk(encoded, size), original);
  }
});

test("multi-chunk ZIP lengths include an exact final remainder", () => {
  const size = ARCHIVE_CHUNK_BYTES * 2 + 17;
  assert.equal(expectedArchiveChunkLength(size, 0), ARCHIVE_CHUNK_BYTES);
  assert.equal(expectedArchiveChunkLength(size, ARCHIVE_CHUNK_BYTES), ARCHIVE_CHUNK_BYTES);
  assert.equal(expectedArchiveChunkLength(size, ARCHIVE_CHUNK_BYTES * 2), 17);
  assert.throws(() => expectedArchiveChunkLength(size, size), /offset/);
  assert.throws(() => expectedArchiveChunkLength(size, -1), /offset/);
});

test("invalid native export sizes are rejected before allocation", () => {
  for (const size of [0, -1, NaN, Infinity, 1.5, MAX_ARCHIVE_BYTES + 1]) {
    assert.throws(() => validateArchiveSize(size), /size/);
  }
  validateArchiveSize(MAX_ARCHIVE_BYTES);
});

test("missing, malformed and oversized native chunks cannot silently truncate a ZIP", () => {
  const valid = encodeArchiveChunk(new Uint8Array([0, 1, 255, 17]));
  assert.throws(() => decodeArchiveChunk(valid, 5), /truncated|length/);
  assert.throws(() => decodeArchiveChunk(valid.slice(0, -4), 4), /truncated/);
  assert.throws(() => decodeArchiveChunk("!!!!", 3), /truncated/);
  assert.throws(() => decodeArchiveChunk("AQID\n", 3), /truncated/);
  assert.throws(() => decodeArchiveChunk(valid, 0), /expected/);
  assert.throws(() => encodeArchiveChunk(new Uint8Array(0)), /length/);
  assert.throws(() => encodeArchiveChunk(new Uint8Array(ARCHIVE_CHUNK_BYTES + 1)), /length/);
});

test("native upload acknowledgements must equal the exact expected offset", () => {
  verifyImportChunkAcknowledgement(ARCHIVE_CHUNK_BYTES, ARCHIVE_CHUNK_BYTES);
  for (const ack of [0, ARCHIVE_CHUNK_BYTES - 1, ARCHIVE_CHUNK_BYTES + 1, NaN, 1.5]) {
    assert.throws(() => verifyImportChunkAcknowledgement(ack, ARCHIVE_CHUNK_BYTES), /acknowledgement/);
  }
});
