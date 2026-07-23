// Cap an image's dimensions before it's stored — the expo port of web-react's
// resize-image.ts (that header is canonical: this is the deferred CLIENT
// thumbnailing step; the extractor server never resizes, so bounding what
// lands in `files/{id}.enc` is the client's job, and it bounds the per-user
// byte quota). Same spec, uri-in/uri-out instead of bytes-in/bytes-out — file
// content stays out of the JS heap on this platform (file-store.ts), and both
// the picker upstream and writeFile downstream speak file uris:
//
//  - Longest side capped at 1024 (CSS px), both dims scaled together (aspect
//    preserved), re-encoded JPEG at 0.82 — web's exact defaults.
//  - Already within the cap → the ORIGINAL uri returned untouched, no
//    transcode. The caller supplies the source dimensions (the picker reports
//    them), so the pass-through needs no decode.
//  - NEVER throws: any manipulator failure (undecodable input, native hiccup)
//    returns the original uri — a resize hiccup can only cost a larger stored
//    blob, never the image itself.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_QUALITY = 0.82;

export interface ResizeImageSource {
  uri: string;
  width: number;
  height: number;
}

// Returns the (possibly new) uri WITH its dimensions, so a resize can chain:
// the edit screen resizes at pick time and hands the result to
// saveCustomImage's backstop resize — if the first attempt fell back (original
// dims ride along), the backstop genuinely retries; if it succeeded (capped
// dims ride along), the backstop passes through for free.
export async function resizeImage(source: ResizeImageSource): Promise<ResizeImageSource> {
  const { uri, width, height } = source;
  const longest = Math.max(width, height);
  // Within the cap — or dimensions unknown (0/NaN, nothing to scale by): the
  // original passes through, the same keep-the-image-over-the-cap bias as
  // web's undecodable-input fallback.
  if (!(longest > DEFAULT_MAX_DIMENSION)) return source;

  try {
    const scale = DEFAULT_MAX_DIMENSION / longest;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: targetWidth, height: targetHeight });
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ compress: DEFAULT_QUALITY, format: SaveFormat.JPEG });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    return source;
  }
}
