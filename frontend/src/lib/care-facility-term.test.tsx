import { renderHook, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Suspense } from "react";
import { useTenantSafe } from "~/lib/tenant-context";
import type { TenantInfo } from "~/lib/tenant-api";
import {
  CareFacilityTermScope,
  normalizeCareFacilityTerm,
  useCareFacilityTerm,
  useCareTermTranslations,
  useProvideCareFacilityTerm,
} from "./care-facility-term";
import { useErrorCareFacilityTerm } from "./care-facility-term-context";

function tenantWithTerm(careFacilityTerm: string | undefined) {
  vi.mocked(useTenantSafe).mockReturnValue({
    tenantSlug: "barnstorf",
    tenant: { careFacilityTerm } as TenantInfo,
  } as ReturnType<typeof useTenantSafe>);
}

describe("care facility term (#6042)", () => {
  it("keeps OGS for schools without a term and for missing metadata", () => {
    expect(normalizeCareFacilityTerm(undefined)).toBe("OGS");
    expect(normalizeCareFacilityTerm("  ")).toBe("OGS");
    expect(normalizeCareFacilityTerm(" GTS ")).toBe("GTS");
    const { result } = renderHook(() => useCareFacilityTerm());
    expect(result.current).toBe("OGS");
  });

  it("fills the tenant's term into the fixed enrollment texts", () => {
    tenantWithTerm("GTS");
    const { result } = renderHook(() =>
      useCareTermTranslations("enrollmentPublic"),
    );
    expect(result.current("reviewTitle")).toBe("Prüfung durch die GTS");
    expect(result.current("reviewText")).toMatch(/^Die GTS prüft/);
  });

  it("keeps the caller's own values next to the term", () => {
    tenantWithTerm("Ganztag Nord");
    const { result } = renderHook(() =>
      useCareTermTranslations("enrollmentForm"),
    );
    expect(result.current("care.noOfferingsForGrade", { grade: 3 })).toBe(
      "Für die 3. Klasse gibt es hier keine passenden Betreuungsangebote. Bei Fragen wende dich bitte an die Ganztag Nord.",
    );
  });

  it("prefers the school a loaded response named over the tenant in context", () => {
    tenantWithTerm("OGS");
    function Status({ term }: { readonly term?: string }) {
      useProvideCareFacilityTerm(term);
      const t = useCareTermTranslations("enrollmentStatus");
      return <p>{t("stepOneStatus")}</p>;
    }
    const { rerender } = render(
      <CareFacilityTermScope>
        <Status />
      </CareFacilityTermScope>,
    );
    expect(
      screen.getByText("Die Anmeldung liegt der OGS vor."),
    ).toBeInTheDocument();
    rerender(
      <CareFacilityTermScope>
        <Status term="GTS" />
      </CareFacilityTermScope>,
    );
    expect(
      screen.getByText("Die Anmeldung liegt der GTS vor."),
    ).toBeInTheDocument();
  });

  it("does not leak a suspended render's term into committed translations", () => {
    tenantWithTerm("OGS");
    const pending = new Promise<void>(() => undefined);
    const seen: ReturnType<typeof useCareTermTranslations>[] = [];
    function Probe({ suspended }: { readonly suspended: boolean }) {
      const t = useCareTermTranslations("enrollmentStatus");
      if (suspended) throw pending;
      seen.push(t);
      return <p>{t("stepOneStatus")}</p>;
    }
    const { rerender } = render(
      <Suspense fallback={<p>Waiting</p>}>
        <Probe suspended={false} />
      </Suspense>,
    );
    const committed = seen[0];
    expect(
      screen.getByText("Die Anmeldung liegt der OGS vor."),
    ).toBeInTheDocument();

    tenantWithTerm("GTS");
    rerender(
      <Suspense fallback={<p>Waiting</p>}>
        <Probe suspended />
      </Suspense>,
    );

    expect(screen.getByText("Waiting")).toBeInTheDocument();
    expect(committed?.("stepOneStatus")).toBe(
      "Die Anmeldung liegt der OGS vor.",
    );
  });

  it("updates rendered text without changing earlier translations", () => {
    tenantWithTerm("OGS");
    const seen: ReturnType<typeof useCareTermTranslations>[] = [];
    function Probe({ term }: { readonly term?: string }) {
      useProvideCareFacilityTerm(term);
      const t = useCareTermTranslations("enrollmentStatus");
      seen.push(t);
      return <p>{t("stepOneStatus")}</p>;
    }
    const { rerender } = render(
      <CareFacilityTermScope>
        <Probe />
      </CareFacilityTermScope>,
    );
    rerender(
      <CareFacilityTermScope>
        <Probe term="GTS" />
      </CareFacilityTermScope>,
    );
    expect(
      screen.getByText("Die Anmeldung liegt der GTS vor."),
    ).toBeInTheDocument();
    expect(seen[0]?.("stepOneStatus")).toBe("Die Anmeldung liegt der OGS vor.");
    expect(seen.at(-1)?.("stepOneStatus")).toBe(
      "Die Anmeldung liegt der GTS vor.",
    );
  });
});

describe("care term on the error path (#6258)", () => {
  it("takes the scope's school first, then the tenant, else OGS", async () => {
    const { TenantProvider } = await vi.importActual<
      typeof import("~/lib/tenant-context")
    >("~/lib/tenant-context");
    const tenant = (careFacilityTerm: string | undefined) =>
      ({ subdomain: "barnstorf", careFacilityTerm }) as TenantInfo;
    const inTenant =
      (term: string | undefined, scope?: string) =>
      ({ children }: { children: React.ReactNode }) => (
        <TenantProvider tenantSlug="barnstorf" tenant={tenant(term)}>
          {scope === undefined ? (
            children
          ) : (
            <CareFacilityTermScope term={scope}>
              {children}
            </CareFacilityTermScope>
          )}
        </TenantProvider>
      );

    expect(
      renderHook(() => useErrorCareFacilityTerm(), { wrapper: inTenant("GTS") })
        .result.current,
    ).toBe("GTS");
    expect(
      renderHook(() => useErrorCareFacilityTerm(), {
        wrapper: inTenant("GTS", "Ganztag Nord"),
      }).result.current,
    ).toBe("Ganztag Nord");
    expect(
      renderHook(() => useErrorCareFacilityTerm(), {
        wrapper: inTenant(undefined),
      }).result.current,
    ).toBe("OGS");
    expect(renderHook(() => useErrorCareFacilityTerm()).result.current).toBe(
      "OGS",
    );
  });
});
