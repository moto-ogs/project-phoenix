import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSWRAuth = vi.hoisted(() => vi.fn());

vi.mock("~/lib/swr", () => ({ useSWRAuth }));
vi.mock("~/lib/tenant-path", () => ({
  useTenantAwarePath: () => (path: string) => path,
}));

import {
  DEVICE_PIN_SETTINGS_PATH,
  DevicePinWarning,
} from "./device-pin-warning";

describe("DevicePinWarning", () => {
  beforeEach(() => {
    useSWRAuth.mockReset();
  });

  it("verlangt eine PIN, solange keine gesetzt ist, und führt zur Einstellung", () => {
    useSWRAuth.mockReturnValue({ data: "missing", error: undefined });

    render(<DevicePinWarning />);

    expect(screen.getByText("Geräte-PIN fehlt")).toBeVisible();
    expect(
      screen.getByText(
        /Ohne Geräte-PIN kann sich Ihr Team nicht am Tablet anmelden/,
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "PIN festlegen" })).toHaveAttribute(
      "href",
      DEVICE_PIN_SETTINGS_PATH,
    );
    // Not dismissable (#7175): the notice ends only when the PIN is set.
    expect(screen.queryByRole("button", { name: /schließen/i })).toBeNull();
  });

  it("bittet bei einer leichten PIN um eine eigene", () => {
    useSWRAuth.mockReturnValue({ data: "too_simple", error: undefined });

    render(<DevicePinWarning />);

    expect(screen.getByText("Geräte-PIN ändern")).toBeVisible();
    expect(screen.getByText(/leicht zu erraten/)).toBeVisible();
  });

  it("zeigt nichts, wenn die Schule eine eigene PIN hat", () => {
    useSWRAuth.mockReturnValue({ data: null, error: undefined });

    const { container } = render(<DevicePinWarning />);

    expect(container).toBeEmptyDOMElement();
  });

  it("zeigt ohne das Recht weder Hinweis noch Fehler", () => {
    const forbidden = Object.assign(new Error("Forbidden"), { status: 403 });
    useSWRAuth.mockReturnValue({ data: undefined, error: forbidden });

    const { container } = render(<DevicePinWarning />);

    expect(container).toBeEmptyDOMElement();
  });
});
