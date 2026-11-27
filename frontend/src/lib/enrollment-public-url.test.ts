import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useEnrollmentPublicUrl } from "./enrollment-public-url";

const originalLocation = window.location;

function setLocation(origin: string, hostname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { origin, hostname },
  });
}

beforeEach(() => {
  setLocation("https://demo.localhost:3000", "demo.localhost");
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("useEnrollmentPublicUrl", () => {
  it("builds the phase picker URL in subdomain mode", () => {
    const { result } = renderHook(() =>
      useEnrollmentPublicUrl({ tenantSlug: "demo" }),
    );
    expect(result.current).toBe("https://demo.localhost:3000/anmeldung");
  });

  it("builds a per-phase URL in subdomain mode", () => {
    const { result } = renderHook(() =>
      useEnrollmentPublicUrl({ tenantSlug: "demo", phaseId: "phase 1" }),
    );
    expect(result.current).toBe(
      "https://demo.localhost:3000/anmeldung/phase%201",
    );
  });

  it("keeps the tenant slug in path mode", () => {
    setLocation("https://localhost:3000", "localhost");
    const { result } = renderHook(() =>
      useEnrollmentPublicUrl({ tenantSlug: "demo", phaseId: "phase 1" }),
    );
    expect(result.current).toBe(
      "https://localhost:3000/demo/anmeldung/phase%201",
    );
  });

  it("returns an empty string without a tenant slug", () => {
    const { result } = renderHook(() =>
      useEnrollmentPublicUrl({ tenantSlug: null }),
    );
    expect(result.current).toBe("");
  });
});
