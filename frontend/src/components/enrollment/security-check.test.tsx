import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("@marsidev/react-turnstile", async () => {
  const { useEffect } = await import("react");
  return {
    Turnstile: function TurnstileMock({
      onSuccess,
    }: {
      onSuccess: (token: string) => void;
    }) {
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

import { SecurityCheck } from "./security-check";

const copy = {
  hint: "Die Sicherheitsprüfung hängt?",
  restart: "Prüfung neu starten",
  restartTooltip: "Lädt die Sicherheitsprüfung neu.",
};

describe("SecurityCheck (#7114)", () => {
  it("sagt, was bei einer hängenden Prüfung zu tun ist, und lädt sie neu", () => {
    mounts.count = 0;
    const onToken = vi.fn();
    render(<SecurityCheck siteKey="site" copy={copy} onToken={onToken} />);

    expect(screen.getByText(/Die Sicherheitsprüfung hängt\?/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Solve captcha" }));
    expect(onToken).toHaveBeenLastCalledWith("token-1");
    expect(mounts.count).toBe(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Prüfung neu starten" }),
    );

    expect(onToken).toHaveBeenLastCalledWith("");
    expect(mounts.count).toBe(2);
  });
});
