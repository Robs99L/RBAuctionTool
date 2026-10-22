export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const PRODUCT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type ProductImageMimeType = (typeof PRODUCT_IMAGE_MIME_TYPES)[number];
export type ProductImageExtension = "png" | "jpg" | "webp";

export function productImageExtension(
  mimeType: string,
  bytes: Uint8Array,
): ProductImageExtension | null {
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  if (mimeType === "image/png" && isPng) return "png";

  const isJpeg =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  if (mimeType === "image/jpeg" && isJpeg) return "jpg";

  return null;
}

export function productImagePathFromUrl(url: string | null | undefined) {
  if (!url) return null;
  try {
    const pathname = new URL(url).pathname;
    const prefix = `/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
    if (!pathname.startsWith(prefix)) return null;
    return decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return null;
  }
}
