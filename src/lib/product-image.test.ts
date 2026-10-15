import { describe, expect, it } from "vitest";

import {
  productImageExtension,
  productImagePathFromUrl,
  PRODUCT_IMAGE_BUCKET,
} from "./product-image";

describe("productImageExtension", () => {
  it("recognizes PNG and JPEG signatures", () => {
    expect(productImageExtension("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(productImageExtension("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  });

  it("rejects a mismatched MIME type or unsupported content", () => {
    expect(productImageExtension("image/jpeg", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBeNull();
    expect(productImageExtension("image/gif", new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
  });
});

describe("productImagePathFromUrl", () => {
  it("extracts paths only from the managed public bucket", () => {
    expect(productImagePathFromUrl(`https://project.supabase.co/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/lot/image.png`)).toBe("lot/image.png");
    expect(productImagePathFromUrl("https://example.com/image.png")).toBeNull();
  });
});
