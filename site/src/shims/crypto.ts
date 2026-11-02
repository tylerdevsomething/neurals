// The part of node:crypto the shared brain/ modules use (createHash('sha256')), for the browser.
import { sha256 } from '@noble/hashes/sha2';
import { Buffer } from 'buffer';

class Sha256 {
  private h = sha256.create();
  update(data: string | Uint8Array): this {
    this.h.update(typeof data === 'string' ? new TextEncoder().encode(data) : data);
    return this;
  }
  digest(): Buffer;
  digest(encoding: 'hex'): string;
  digest(encoding?: 'hex'): Buffer | string {
    const out = Buffer.from(this.h.digest());
    return encoding === 'hex' ? out.toString('hex') : out;
  }
}

export function createHash(algorithm: string): Sha256 {
  if (algorithm !== 'sha256') throw new Error(`only sha256 is available in the browser, not ${algorithm}`);
  return new Sha256();
}

export function randomBytes(n: number): Buffer {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n)));
}
