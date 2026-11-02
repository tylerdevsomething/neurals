// The claimed bits of a posted epoch account (layout in programs/neurals: Epoch), or null.
export function claimedBits(data: Uint8Array | undefined | null): Uint8Array | null {
  if (!data) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const len = v.getUint32(8 + 8 + 32 + 8 + 8 + 4, true);
  return data.subarray(72, 72 + len);
}
