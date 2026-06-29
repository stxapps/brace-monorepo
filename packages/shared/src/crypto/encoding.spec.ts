import { base64ToBytes, bytesToBase64 } from './encoding';

// The base64 ⇄ bytes pair used for the inline preview-image wire form. Both halves
// live here now (the extractor encodes, the clients decode), so they round-trip
// against the same implementation.
describe('bytesToBase64 / base64ToBytes', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128, 1]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('handles a body larger than the fromCharCode chunk size', () => {
    // 0x8000 is the chunk boundary in bytesToBase64; cross it to exercise chunking.
    const bytes = new Uint8Array(0x8000 + 100).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
