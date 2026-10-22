import "server-only";

import sharp from "sharp";

export const OPTIMIZED_PRODUCT_IMAGE_MAX_BYTES = 500 * 1024;

const OUTPUT_PROFILES = [
  { dimension: 1600, quality: 82 },
  { dimension: 1600, quality: 72 },
  { dimension: 1400, quality: 72 },
  { dimension: 1200, quality: 68 },
  { dimension: 1000, quality: 64 },
  { dimension: 800, quality: 60 },
] as const;

export async function optimizeProductImage(bytes: Uint8Array) {
  let smallest: Buffer | null = null;

  for (const profile of OUTPUT_PROFILES) {
    const output = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width: profile.dimension,
        height: profile.dimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: profile.quality, effort: 4 })
      .toBuffer();

    smallest = !smallest || output.length < smallest.length ? output : smallest;
    if (output.length <= OPTIMIZED_PRODUCT_IMAGE_MAX_BYTES) {
      return {
        bytes: new Uint8Array(output),
        extension: "webp" as const,
        contentType: "image/webp" as const,
      };
    }
  }

  throw new Error(
    `The optimized event image still exceeds ${Math.round(OPTIMIZED_PRODUCT_IMAGE_MAX_BYTES / 1024)} KB (${smallest?.length ?? 0} bytes).`,
  );
}
