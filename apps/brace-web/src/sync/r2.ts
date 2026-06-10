'use client';

// Direct blob transfer to/from Cloudflare R2 over a presigned URL — the ONE data
// path that bypasses the API (docs/local-first-sync.md: "the blob bytes never
// touch the API"). The URL is a short-lived SigV4 presign minted by
// `files/sign`; the bytes are already AES-GCM encrypted (see crypto.ts), so R2
// only ever sees ciphertext. No auth header here — the signature in the URL is
// the credential.

export async function putBlob(url: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
  const res = await fetch(url, { method: 'PUT', body });
  if (!res.ok) throw new Error(`R2 PUT failed (${res.status})`);
}

export async function getBlob(url: string): Promise<Uint8Array> {
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`R2 GET failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
