import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import {
  CHUNK_BYTES, chunkCount, chunkSlice, encodeChunk, decodeChunk, fileTag, chunkTransaction, checkManifest, encodeManifest, sha256Hex, MANIFEST_FORMAT,
} from '../brain/inscribe.ts';

test('a file splits into 960-byte chunks that join back exactly', () => {
  const file = Buffer.from(Array.from({ length: 2500 }, (_, i) => i % 251));
  assert.equal(chunkCount(file.length), 3);
  const parts = [0, 1, 2].map((i) => decodeChunk(encodeChunk(i, chunkSlice(file, i)))!);
  assert.deepEqual(parts.map((p) => p.index), [0, 1, 2]);
  assert.deepEqual(parts.map((p) => p.bytes.length), [960, 960, 580]);
  assert.deepEqual(Buffer.concat(parts.map((p) => p.bytes)), file);
});

test('chunk data is rejected unless it is exactly ours', () => {
  const ok = encodeChunk(5, Buffer.from('hello'));
  assert.deepEqual(decodeChunk(ok), { index: 5, bytes: Buffer.from('hello') });
  const other = Buffer.from(ok);
  other[0] = 0x58;
  assert.equal(decodeChunk(other), null, 'wrong magic');
  const v2 = Buffer.from(ok);
  v2[4] = 2;
  assert.equal(decodeChunk(v2), null, 'unknown version');
  assert.equal(decodeChunk(ok.subarray(0, 10)), null, 'no bytes');
  assert.throws(() => encodeChunk(0, Buffer.alloc(CHUNK_BYTES + 1)));
  assert.throws(() => encodeChunk(-1, Buffer.from('x')));
});

test('a chunk transaction fits a legacy transaction', () => {
  const writer = Keypair.generate();
  const tag = fileTag('ab'.repeat(32), writer.publicKey);
  const tx = chunkTransaction({ writer: writer.publicKey, tag, index: 7, bytes: Buffer.alloc(CHUNK_BYTES, 1), blockhash: '11111111111111111111111111111111', microLamports: 1000 });
  tx.sign(writer);
  assert.ok(tx.serialize().length <= 1232, `${tx.serialize().length} bytes`);
});

test('the tag depends on the file and the writer', () => {
  const a = Keypair.generate().publicKey;
  const b = Keypair.generate().publicKey;
  assert.ok(fileTag('00'.repeat(32), a).equals(fileTag('00'.repeat(32), a)));
  assert.ok(!fileTag('00'.repeat(32), a).equals(fileTag('00'.repeat(32), b)));
  assert.ok(!fileTag('00'.repeat(32), a).equals(fileTag('01'.repeat(32), a)));
});

test('manifests are checked and sorted, so every writer encodes the same bytes', () => {
  const w = Keypair.generate().publicKey.toBase58();
  const model = { role: 'model' as const, name: 'brain.gguf', size: 10, sha256: sha256Hex(Buffer.from('m')), writer: w };
  const rt = { role: 'runtime' as const, name: 'runner.wasm', size: 5, sha256: sha256Hex(Buffer.from('r')), writer: w };
  const a = encodeManifest({ format: MANIFEST_FORMAT, model: model.sha256, files: [rt, model] });
  const b = encodeManifest({ format: MANIFEST_FORMAT, model: model.sha256, files: [model, rt] });
  assert.deepEqual(a, b);
  assert.throws(() => checkManifest({ format: MANIFEST_FORMAT, model: '00'.repeat(32), files: [model] }), /not among/);
  assert.throws(() => checkManifest({ format: 'other', model: model.sha256, files: [model] }));
  assert.throws(() => checkManifest({ format: MANIFEST_FORMAT, model: model.sha256, files: [model, model] }), /duplicate/);
});
