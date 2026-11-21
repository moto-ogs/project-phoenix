import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import type { StaffNotice } from "~/lib/staff-notices-api";
import { catalogText } from "~/test/error-catalog-text";
import { SAVED_BUT_STALE_SUFFIX } from "~/lib/hooks/use-refresh-after-write";

import { TodayNoticeList } from "./today-notice-list";

const invalidate = vi.hoisted(() => vi.fn());

vi.mock("~/lib/swr", () => ({
  useInvalidateMatching: () => invalidate,
}));

// The component refreshes the scoped cache, which needs the session.
function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <SessionProvider
      session={{ user: { id: "1" }, expires: "2099-01-01" }}
      refetchOnWindowFocus={false}
    >
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}

const notice: StaffNotice = {
  id: "42",
  title: "Dienstbesprechung",
  body: "Heute um 14 Uhr im Lehrerzimmer.",
  priority: "info",
  audience: "all",
  valid_from: "2026-09-09",
  weekdays: [],
  week_pattern: 0,
  requires_acknowledgement: true,
  active: true,
};

describe("TodayNoticeList", () => {
  // #2517: eine Aktion ohne Formular meldet den Fehler mit Katalogtext und
  // Wiederholen, nicht mit dem Satz des Servers.
  it("shows a failed acknowledgement as a message and retries it", async () => {
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("ack kaputt", 500, { code: "general.server" }),
      )
      .mockResolvedValueOnce(undefined);
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <TodayNoticeList
        notices={[notice]}
        onChanged={onChanged}
        acknowledge={acknowledge}
      />,
      { wrapper: Providers },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Zur Kenntnis nehmen" }),
    );

    expect(
      await screen.findByText(
        catalogText("general.server", "die Kenntnisnahme"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/kaputt/)).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Wiederholen/ }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(acknowledge).toHaveBeenLastCalledWith("42");
    const matcher = invalidate.mock.calls.at(-1)?.[0];
    expect(matcher).toEqual(expect.any(Function));
    expect(matcher("staff-notices:1")).toBe(true);
    expect(matcher("staff-notice-acknowledgements-42")).toBe(true);
  });

  // #6652: die Kenntnisnahme gilt, sobald sie gespeichert ist; ein
  // gescheitertes Nachladen ist ein Ladefehler und nimmt nichts erneut zur
  // Kenntnis.
  it("keeps an acknowledgement when the reload fails", async () => {
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const onChanged = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError("down", 503, { code: "general.unavailable" }),
      )
      .mockResolvedValue(undefined);
    render(
      <TodayNoticeList
        notices={[notice]}
        onChanged={onChanged}
        acknowledge={acknowledge}
      />,
      { wrapper: Providers },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Zur Kenntnis nehmen" }),
    );

    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Anzeige der Hinweise der Leitung")} ${SAVED_BUT_STALE_SUFFIX}`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        catalogText("general.unavailable", "die Kenntnisnahme"),
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(2));
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  // #4365: auf der Seite Tagesinformationen füllen die Hinweise die Breite
  // als Raster; Startseite und moto schule behalten die gestapelte Liste.
  it("lays the notices out as a grid only when asked to", () => {
    const { rerender } = render(
      <Providers>
        <TodayNoticeList notices={[notice]} onChanged={vi.fn()} />
      </Providers>,
    );
    expect(screen.getByRole("list").className).not.toContain("grid");

    rerender(
      <Providers>
        <TodayNoticeList notices={[notice]} onChanged={vi.fn()} layout="grid" />
      </Providers>,
    );
    expect(screen.getByRole("list").className).toContain("grid");
  });
});
