import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";

const mounts = vi.hoisted(() => ({
  count: 0,
  props: undefined as
    | undefined
    | {
        onWidgetLoad?: () => void;
        onBeforeInteractive?: () => void;
        onSuccess: (token: string) => void;
        onError?: () => void;
        onUnsupported?: () => void;
        scriptOptions?: { onError?: () => void };
      },
}));

vi.mock("@marsidev/react-turnstile", async () => {
  const { useEffect } = await import("react");
  return {
    Turnstile: function TurnstileMock(
      props: {
        onSuccess: (token: string) => void;
      } & NonNullable<typeof mounts.props>,
    ) {
      const { onSuccess } = props;
      mounts.props = props;
      useEffect(() => {
        mounts.count += 1;
      }, []);
      return (
        <button type="button" onClick={() => onSuccess("token-1")}>
          Solve captcha
        </button>
      );
    },
  };
});

import {
  SECURITY_CHECK_LOAD_TIMEOUT_MS,
  SecurityCheck,
} from "./security-check";

const copy = {
  hint: "Die Sicherheitsprüfung lädt nicht oder bleibt stehen?",
  restart: "Prüfung neu starten",
  restartTooltip: "Lädt die Sicherheitsprüfung neu.",
  failedTitle: "Die Sicherheitsprüfung lädt nicht",
  failedText: "Oft blockiert ein Werbeblocker die Prüfung. So geht es weiter:",
  failedStepBlocker: "Schalten Sie den Werbeblocker aus.",
  failedStepRestart: "Wählen Sie „Prüfung neu starten“.",
  failedStepBrowser: "Öffnen Sie den Link in einem anderen Browser.",
  copyLink: "Link kopieren",
  copyLinkTooltip: "Kopiert die Adresse dieser Seite.",
  linkCopied: "Link kopiert",
  copyFailed: "Kopieren geht hier nicht. Das ist der Link:",
};

function Check({ onToken }: { onToken: (value: string) => void }) {
  const [token, setToken] = useState("");
  return (
    <SecurityCheck
      siteKey="site"
      copy={copy}
      token={token}
      onToken={(value) => {
        setToken(value);
        onToken(value);
      }}
    />
  );
}

describe("SecurityCheck (#7114)", () => {
  it("sagt, was bei einer hängenden Prüfung zu tun ist, und lädt sie neu", () => {
    mounts.count = 0;
    const onToken = vi.fn();
    render(<Check onToken={onToken} />);

    expect(screen.getByText(/lädt nicht oder bleibt stehen\?/)).toBeVisible();
    expect(mounts.count).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Prüfung neu starten" }),
    );

    expect(onToken).toHaveBeenLastCalledWith("");
    expect(mounts.count).toBe(2);
  });

  it("blendet den Hinweis aus, sobald die Prüfung bestanden ist", () => {
    const onToken = vi.fn();
    render(<Check onToken={onToken} />);
    expect(
      screen.getByRole("button", { name: "Prüfung neu starten" }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));

    expect(onToken).toHaveBeenLastCalledWith("token-1");
    expect(
      screen.queryByRole("button", { name: "Prüfung neu starten" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solve captcha" })).toBeVisible();
  });

  it.each([
    ["das Skript nicht lädt", () => mounts.props?.scriptOptions?.onError?.()],
    ["Cloudflare einen Fehler meldet", () => mounts.props?.onError?.()],
    [
      "der Browser die Prüfung nicht kann",
      () => mounts.props?.onUnsupported?.(),
    ],
  ])("sagt, was zu tun ist, wenn %s", (_case, failCheck) => {
    const onToken = vi.fn();
    render(<Check onToken={onToken} />);

    act(() => failCheck());

    expect(screen.getByText(copy.failedTitle)).toBeVisible();
    expect(screen.getByText(copy.failedText)).toBeVisible();
    expect(
      screen.getAllByRole("listitem").map((item) => item.textContent),
    ).toEqual([
      copy.failedStepBlocker,
      copy.failedStepRestart,
      copy.failedStepBrowser,
    ]);
    expect(screen.queryByText(copy.hint)).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Prüfung neu starten" }),
    );

    expect(screen.queryByText(copy.failedTitle)).not.toBeInTheDocument();
    expect(screen.getByText(copy.hint)).toBeVisible();
  });

  it("meldet eine Prüfung, die nach der Wartezeit nicht erscheint", () => {
    vi.useFakeTimers();
    render(<Check onToken={vi.fn()} />);

    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS - 1));
    expect(screen.getByText(copy.hint)).toBeVisible();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(copy.failedTitle)).toBeVisible();
  });

  it("meldet ein erstelltes Widget, dessen Aufgabe nicht lädt", () => {
    vi.useFakeTimers();
    const { container } = render(<Check onToken={vi.fn()} />);

    act(() => mounts.props?.onWidgetLoad?.());
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS));

    expect(screen.getByText(copy.failedTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: copy.copyLink })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: copy.restart }));
    expect(screen.getByText(copy.hint)).toBeVisible();
    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS));
    expect(screen.getByText(copy.failedTitle)).toBeVisible();

    act(() => mounts.props?.onSuccess("token-1"));
    expect(screen.getByRole("button", { name: "Solve captcha" })).toBeVisible();
    expect(screen.queryByText(copy.failedTitle)).not.toBeInTheDocument();
  });

  it("wartet nicht weiter, sobald die interaktive Aufgabe bereit ist", () => {
    vi.useFakeTimers();
    render(<Check onToken={vi.fn()} />);

    act(() => mounts.props?.onBeforeInteractive?.());
    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS * 2));

    expect(screen.getByText(copy.hint)).toBeVisible();
    expect(screen.queryByText(copy.failedTitle)).not.toBeInTheDocument();
  });

  it("hält den Platz der Prüfung frei, bis die interaktive Aufgabe bereit ist", () => {
    const { container } = render(<Check onToken={vi.fn()} />);
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();

    act(() => mounts.props?.onBeforeInteractive?.());

    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solve captcha" })).toBeVisible();
  });

  it("wartet nach einem Erfolg ohne interaktive Aufgabe nicht weiter", () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn");
    const { container } = render(<Check onToken={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS * 2));

    expect(screen.getByRole("button", { name: "Solve captcha" })).toBeVisible();
    expect(container.querySelector(".animate-pulse")).not.toBeInTheDocument();
    expect(screen.queryByText(copy.failedTitle)).not.toBeInTheDocument();
    expect(warn).not.toHaveBeenCalledWith(
      "security_check_failed",
      expect.anything(),
    );
  });

  it("kopiert den Link dieser Seite für einen anderen Browser", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Check onToken={vi.fn()} />);
    act(() => mounts.props?.scriptOptions?.onError?.());

    fireEvent.click(screen.getByRole("button", { name: copy.copyLink }));

    expect(
      await screen.findByRole("button", { name: copy.linkCopied }),
    ).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    vi.unstubAllGlobals();
  });

  it("zeigt den Link zum Abschreiben, wenn das Gerät nicht kopieren lässt", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<Check onToken={vi.fn()} />);
    act(() => mounts.props?.scriptOptions?.onError?.());

    fireEvent.click(screen.getByRole("button", { name: copy.copyLink }));

    expect(await screen.findByText(copy.copyFailed)).toBeVisible();
    expect(screen.getByText(window.location.href)).toBeVisible();
    vi.unstubAllGlobals();
  });
});
