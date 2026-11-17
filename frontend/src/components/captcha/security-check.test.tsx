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
  failedTitle: "Die Sicherheitsprüfung lädt nicht.",
  failedText: "Oft blockiert ein Werbeblocker die Prüfung.",
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

  it("wartet nicht weiter, sobald die Prüfung erschienen ist", () => {
    vi.useFakeTimers();
    render(<Check onToken={vi.fn()} />);

    act(() => mounts.props?.onWidgetLoad?.());
    act(() => vi.advanceTimersByTime(SECURITY_CHECK_LOAD_TIMEOUT_MS * 2));

    expect(screen.getByText(copy.hint)).toBeVisible();
    expect(screen.queryByText(copy.failedTitle)).not.toBeInTheDocument();
  });
});
