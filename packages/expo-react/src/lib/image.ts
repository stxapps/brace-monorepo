// The device's IMAGE PRIMITIVES — the things every path that puts an image into
// the store needs before it can: cap it (`resizeImage`), learn its dimensions
// (`probeImageSize`, the input `resizeImage` demands), and decide whether the
// bytes are a renderable image at all (`sniffImageMime` for raster, `isSvgBytes`
// for the one format only the icon path takes — the two sniffs' headers draw
// that line). They sit together because they're the same LAYER, not the same
// feature: each is a thin wrapper over a native decoder or the byte shape one
// expects, each is uri- or bytes-shaped rather than store-shaped, and each NEVER
// THROWS — every one degrades to "keep what we had", so an image can only ever
// end up bigger or absent, never lost to a hiccup.
//
// The web sibling is `packages/web-react/src/lib/resize-image.ts`, which is
// resize ONLY: there `createImageBitmap` sniffs the format itself and reports
// the dimensions off the decoded bitmap, so neither of the other two exists.
// That header stays canonical for the RESIZE contract — the deferred CLIENT
// thumbnailing step; the extractor server never resizes, so bounding what lands
// in `files/{id}.enc` is the client's job, and it bounds the per-user byte
// quota.
//
// Callers: the edit screen's custom-image pick and `saveCustomImage`
// (hooks/use-link-mutations.ts), the on-device extraction worker
// (lib/device-extraction.ts), and the favicon fillers, through
// lib/favicon-fetch.ts's `isRenderableIconBytes` (the two sniffs only).

import { Image } from 'react-native';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const DEFAULT_MAX_DIMENSION = 1024;
const DEFAULT_QUALITY = 0.82;

export interface ResizeImageSource {
  uri: string;
  width: number;
  height: number;
}

// Cap an image's dimensions before it's stored. Web's spec, uri-in/uri-out
// instead of bytes-in/bytes-out — file content stays out of the JS heap on this
// platform (file-store.ts), and both the picker upstream and writeFile
// downstream speak file uris:
//
//  - Longest side capped at 1024 (CSS px), both dims scaled together (aspect
//    preserved), re-encoded JPEG at 0.82 — web's exact defaults.
//  - Already within the cap → the ORIGINAL uri returned untouched, no
//    transcode. The caller supplies the source dimensions (the picker reports
//    them; anything downloaded has to `probeImageSize` first), so the
//    pass-through needs no decode.
//  - NEVER throws: any manipulator failure (undecodable input, native hiccup)
//    returns the original uri — a resize hiccup can only cost a larger stored
//    blob, never the image itself.
//
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

// An image's intrinsic dimensions, or undefined if the native decoder can't
// read it. Promisified `Image.getSize` — RN's only decode-free probe.
//
// This is `resizeImage`'s missing input, not a general utility: `resizeImage`
// takes the source dimensions from its CALLER and passes the image through
// untouched when they're absent, which is right for the picker (it reports
// them) and wrong for anything DOWNLOADED — without a probe a 4000px hero would
// skip the cap entirely and land whole in the user's byte quota. So a caller
// holding fetched bytes rather than a picker asset probes first.
export function probeImageSize(
  uri: string,
): Promise<{ width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve(width > 0 && height > 0 ? { width, height } : undefined),
      () => resolve(undefined),
    );
  });
}

// The RASTER formats a fetching path may keep (every decoder in play — ImageIO,
// Fresco, SDWebImage, Glide — covers this set, ICO included), identified by
// magic bytes. This is the verdict the STORED-PREVIEW path wants exactly, and
// the reason is downstream: `probeImageSize` and `resizeImage` are both
// raster-only, so anything that passes here must be something they can measure
// and cap — an SVG would sail past the 1024px cap and land whole in the user's
// byte quota. The ICON path wants MORE than this; see `isSvgBytes` below. An
// HTML error page (no magic bytes) misses either way, which is the case that
// actually shows up. The RENDER path never needs the mime: native sniffs the
// file bytes itself; returning it (vs. a boolean) just keeps the check
// self-documenting.
export function sniffImageMime(b: Uint8Array): string | undefined {
  if (b.length < 12) return undefined;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return undefined;
}

// How far in to look for the root tag. A favicon is capped at 512 KB, but the
// prologue that may precede `<svg>` is an XML declaration, a comment or two and
// a doctype — a kilobyte is generous for that, and nothing past it can change
// the verdict.
const SVG_SNIFF_BYTES = 1024;

// Only an XML declaration, comments, or an SVG doctype may precede the root tag.
// That's the whole point of anchoring: an HTML error page can carry an inline
// `<svg>` ANYWHERE in it, so "contains `<svg`" would accept exactly the thing
// this check exists to reject, while "the document's FIRST tag is `<svg>`" puts
// `<!DOCTYPE html>`/`<html>` out of reach.
const SVG_ROOT =
  /^\s*(?:(?:<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg\b[^>]*>)\s*)*<svg[\s/>]/i;

// Is this an SVG document? The one NON-raster format the icon path accepts, and
// the reason it can: favicons render through expo-image, which decodes SVG on
// both platforms (SDWebImageSVGCoder on iOS, androidsvg on Android) — and
// `<link rel=icon type="image/svg+xml">` is common enough that rejecting it left
// those hosts on the monogram permanently. Deliberately NOT folded into
// `sniffImageMime`: that verdict guards the store path, which must keep saying
// no (see its header).
//
// Sniffing text takes more care than magic bytes — hence SVG_ROOT above. Only
// the head is decoded, and TextDecoder is non-fatal, so binary input degrades to
// replacement characters and simply fails to match (a raster format would have
// been caught by the magic-byte sniff first anyway); it also strips a leading
// BOM for us.
export function isSvgBytes(b: Uint8Array): boolean {
  return SVG_ROOT.test(new TextDecoder().decode(b.subarray(0, SVG_SNIFF_BYTES)));
}
