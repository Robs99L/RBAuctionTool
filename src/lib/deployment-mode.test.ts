import { describe, expect, it } from "vitest";

import { shouldUseDemoMode } from "./deployment-mode";

describe("deployment mode", () => {
  it("fails closed in production when Supabase is missing", () => {
    expect(shouldUseDemoMode({ forced: false, configured: false, production: true })).toBe(false);
  });

  it("uses local demo data for an unconfigured development environment", () => {
    expect(shouldUseDemoMode({ forced: false, configured: false, production: false })).toBe(true);
  });

  it("honors an explicitly forced demo", () => {
    expect(shouldUseDemoMode({ forced: true, configured: true, production: true })).toBe(true);
  });
});
