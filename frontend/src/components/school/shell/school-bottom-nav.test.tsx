import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SchoolBottomNav } from "./school-bottom-nav";

const teamChat = { unreadCount: 0, available: false } as const;

const mockPathname = vi.hoisted(() => ({ value: "/" }));
const mockSearch = vi.hoisted(() => ({ value: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname.value,
  useSearchParams: () => new URLSearchParams(mockSearch.value),
}));

vi.mock("~/lib/school-url", () => ({
  schoolPath: (path: string) => path.replace(/^\/school/, "") || "/",
}));

describe("SchoolBottomNav", () => {
  // Seit dem dritten Ziel (#2527) traegt nur das aktive Feld seine
  // Beschriftung: drei volle Namen passen auf 390 px nicht in die Pille und
  // schoben "Hilfe" aus dem Bild. Erreichbar bleiben alle ueber ihren
  // versteckten Namen im Feld (#7112).
  it("beschriftet das aktive Ziel und benennt die uebrigen fuer Screenreader", () => {
    mockPathname.value = "/";
    render(<SchoolBottomNav teamChat={teamChat} />);

    expect(screen.getByText("Klassenansicht")).toBeInTheDocument();
    expect(screen.getByText("Meine Aufsichten")).toHaveClass("sr-only");
    expect(screen.getByText("Hinweise der Leitung")).toHaveClass("sr-only");
    expect(screen.getByText("Hilfe")).toHaveClass("sr-only");

    expect(
      screen.getByRole("link", { name: "Meine Aufsichten" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Hinweise der Leitung" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hilfe" })).toBeInTheDocument();
  });

  it("verschiebt die Beschriftung mit dem aktiven Ziel", () => {
    mockPathname.value = "/aufsichten";
    render(<SchoolBottomNav teamChat={teamChat} />);

    expect(screen.getByText("Meine Aufsichten")).not.toHaveClass("sr-only");
    expect(screen.getByText("Klassenansicht")).toHaveClass("sr-only");
  });

  // Auch ohne Team-Chat sind es seit den Fehlzeiten (#4793) sieben Ziele:
  // breite Abstände würden auf 360 px überlaufen. Beide Besetzungen
  // verwenden die kompakte Darstellung.
  it("verwendet bei sieben Zielen ohne Team-Chat die kompakte Darstellung", () => {
    mockPathname.value = "/aufsichten";
    render(<SchoolBottomNav teamChat={teamChat} />);

    expect(document.querySelectorAll("[data-school-nav-item]")).toHaveLength(7);
    expect(
      screen.getByRole("link", { name: "Fehlzeiten" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Meine Aufsichten")).toHaveClass(
      "hidden",
      "min-[480px]:inline",
    );
    expect(screen.getByRole("list")).toHaveClass("gap-0");
    expect(screen.getByRole("link", { name: "Elternbriefe" })).toHaveClass(
      "px-2.5",
    );
  });

  // Mit den Fehlzeiten (#4793) sind es mit Team-Chat acht Ziele: die Icons
  // rücken noch enger zusammen (8 × 36 px passen in die 294 px der Pille),
  // die Beschriftung kommt erst ab 480 px dazu.
  it("blendet die Beschriftung bei acht Zielen mit Team-Chat unterhalb von 480 px aus", () => {
    mockPathname.value = "/aufsichten";
    render(<SchoolBottomNav teamChat={{ unreadCount: 0, available: true }} />);

    expect(document.querySelectorAll("[data-school-nav-item]")).toHaveLength(8);
    expect(screen.getByText("Meine Aufsichten")).toHaveClass(
      "hidden",
      "min-[480px]:inline",
    );
    expect(screen.getByRole("link", { name: "Elternbriefe" })).toHaveClass(
      "px-2",
    );
    expect(screen.getByRole("link", { name: "Elternbriefe" })).not.toHaveClass(
      "px-2.5",
    );
  });

  it("zeigt offene Tagesinformationen als Zahl am Icon (#2208)", () => {
    mockPathname.value = "/";
    render(
      <SchoolBottomNav teamChat={teamChat} notices={{ pendingCount: 3 }} />,
    );

    // The count is part of the field's name (#7112).
    const notices = screen.getByRole("link", {
      name: "Hinweise der Leitung 3 offene Hinweise der Leitung",
    });
    expect(within(notices).getByText("3")).toHaveTextContent(
      /^3 offene Hinweise der Leitung$/,
    );
  });

  it("zeigt in den Einstellungen Rückweg und beide Bereiche ohne Mehr", () => {
    mockPathname.value = "/einstellungen";
    mockSearch.value = "tab=privacy";
    render(<SchoolBottomNav teamChat={teamChat} />);

    expect(
      screen.getByRole("link", { name: "Zurück zur App" }),
    ).toHaveAttribute("href", "/");
    expect(
      screen.getByRole("link", { name: "Benachrichtigungen" }),
    ).toHaveAttribute("href", "/einstellungen?tab=notifications");
    expect(screen.getByRole("link", { name: "Datenschutz" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "Mehr" })).toBeNull();
    mockPathname.value = "/";
    mockSearch.value = "";
  });

  it("verschwindet ab der Sidebar-Breite", () => {
    render(<SchoolBottomNav teamChat={teamChat} />);

    expect(screen.getByRole("navigation")).toHaveClass("lg:hidden");
  });
});
