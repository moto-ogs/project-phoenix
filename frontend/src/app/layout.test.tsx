import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import RootLayout, { generateMetadata, viewport } from "./layout";

const headerState = vi.hoisted(() => ({
  host: "moto-app.de",
}));

vi.mock("next/font/local", () => ({
  default: ({ variable }: { variable: string }) => ({
    className: variable === "--font-inter" ? "inter-font-class" : "",
    variable,
  }),
}));

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name.toLowerCase() === "host" ? headerState.host : null,
    }),
}));

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

// Mock child components
vi.mock("./providers", () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="providers">{children}</div>
  ),
}));

vi.mock("~/components/background-wrapper", () => ({
  BackgroundWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="background-wrapper">{children}</div>
  ),
}));

describe("RootLayout", () => {
  beforeEach(() => {
    headerState.host = "moto-app.de";
    navigationState.pathname = "/";
    vi.stubEnv("NEXT_PUBLIC_OPERATOR_HOSTNAME", "operator.moto-app.de");
    vi.stubEnv("NEXT_PUBLIC_PARENTS_HOSTNAME", "eltern.moto-app.de");
    vi.stubEnv("NEXT_PUBLIC_SCHOOL_HOSTNAME", "schule.moto-app.de");
    vi.stubEnv("NEXT_PUBLIC_TRAEGER_HOSTNAME", "traeger.moto-app.de");
    vi.stubEnv("NEXT_PUBLIC_CATERER_HOSTNAME", "caterer.moto-app.de");
    vi.stubEnv("TENANT_DOMAIN", "moto-app.de");
  });

  // RootLayout is an async server component (it awaits getLocale() for the
  // <html lang>), so it must be resolved before handing the element to render.
  it("renders children wrapped in providers", async () => {
    const { getByText, getByTestId } = render(
      await RootLayout({ children: <div>Test Content</div> }),
    );

    expect(getByText("Test Content")).toBeInTheDocument();
    expect(getByTestId("providers")).toBeInTheDocument();
    expect(getByTestId("background-wrapper")).toBeInTheDocument();
  });

  it("wraps content in providers and background wrapper", async () => {
    const { getByTestId } = render(
      await RootLayout({ children: <div>Test</div> }),
    );

    // Verify both wrapper components are present
    expect(getByTestId("providers")).toBeInTheDocument();
    expect(getByTestId("background-wrapper")).toBeInTheDocument();
  });

  // #7109: the title names the page and the portal of the host.
  it("renders the title of the current page", async () => {
    headerState.host = "schule.moto-app.de";
    navigationState.pathname = "/kalender";

    render(await RootLayout({ children: <div>Test</div> }));

    await waitFor(() =>
      expect(document.title).toBe("Kalender – Schule – moto"),
    );
  });

  it("renders with an unparsable Host header", async () => {
    headerState.host = "bad host[";
    navigationState.pathname = "/start";

    render(await RootLayout({ children: <div>Test</div> }));

    await waitFor(() => expect(document.title).toBe("Erstgespräch – moto"));
  });

  describe("metadata", () => {
    // #7109: every page names itself through RouteTitle; a shared title
    // here would give 100 pages the same tab name again.
    it("sets no shared title", async () => {
      const metadata = await generateMetadata();

      expect(metadata).not.toHaveProperty("title");
    });

    it("has correct description", async () => {
      const metadata = await generateMetadata();

      expect(metadata.description).toBe(
        "Das innovative An- und Abmeldesystem mit NFC-Armbändern für die offene Ganztagsschule. DSGVO-konform, entwickelt an der Universität Münster.",
      );
    });

    it("uses the normal favicon on normal hosts", async () => {
      const metadata = await generateMetadata();

      expect(metadata.icons).toEqual([
        {
          rel: "icon",
          url: "/favicons/normal/favicon.ico",
          type: "image/x-icon",
        },
        {
          rel: "icon",
          url: "/favicons/normal/icon-32.png",
          type: "image/png",
          sizes: "32x32",
        },
        {
          rel: "apple-touch-icon",
          url: "/favicons/normal/apple-touch-icon.png",
          sizes: "180x180",
        },
      ]);
    });

    it("uses localized metadata on the parent host", async () => {
      headerState.host = "eltern.moto-app.de";

      const metadata = await generateMetadata();

      expect(metadata).not.toHaveProperty("title");
      expect(metadata.description).toContain("Betreuung Ihres Kindes");
    });

    it("uses operator favicon assets on the operator host", async () => {
      headerState.host = "operator.moto-app.de";

      const metadata = await generateMetadata();

      expect(metadata.icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "/favicons/operator/icon-32.png",
          }),
        ]),
      );
    });

    it("uses staging parents favicon assets on the staging eltern host", async () => {
      headerState.host = "eltern.staging.moto-app.de";
      vi.stubEnv(
        "NEXT_PUBLIC_OPERATOR_HOSTNAME",
        "operator.staging.moto-app.de",
      );
      vi.stubEnv("NEXT_PUBLIC_PARENTS_HOSTNAME", "eltern.staging.moto-app.de");
      vi.stubEnv("NEXT_PUBLIC_SCHOOL_HOSTNAME", "schule.staging.moto-app.de");

      const metadata = await generateMetadata();

      expect(metadata.icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            url: "/favicons/eltern-staging/icon-32.png",
          }),
        ]),
      );
    });

    it("has correct manifest", async () => {
      const metadata = await generateMetadata();

      expect(metadata.manifest).toBe("/manifest.webmanifest");
    });
  });

  describe("viewport", () => {
    // Bewusste Regeländerung (#2267): der Zoom darf nicht gesperrt sein.
    it("has correct viewport settings", () => {
      expect(viewport).toEqual({
        width: "device-width",
        initialScale: 1,
      });
    });

    it("erlaubt Pinch-Zoom", () => {
      expect(viewport).not.toHaveProperty("maximumScale");
      expect(viewport).not.toHaveProperty("userScalable");
    });
  });
});
