import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SecurityCheck } from "./security-check";

afterEach(() => {
  document.getElementById("moto-security-check-script")?.remove();
  vi.unstubAllGlobals();
});

it("retries a failed script request and solves the replacement widget", async () => {
  const copy = {
    hint: "Prüfung lädt nicht?",
    restart: "Prüfung neu starten",
    restartTooltip: "Prüfung erneut laden",
    failedTitle: "Prüfung lädt nicht.",
    failedText: "Werbeblocker ausschalten.",
  };
  function Form() {
    const [token, setToken] = useState("");
    return (
      <>
        <SecurityCheck
          siteKey="site"
          copy={copy}
          token={token}
          onToken={setToken}
        />
        <output aria-label="Captcha token">{token}</output>
      </>
    );
  }
  const view = render(<Form />);
  const failedScript = document.querySelector<HTMLScriptElement>(
    'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
  );
  expect(failedScript).not.toBeNull();
  fireEvent.error(failedScript!);
  // The real library reports the blocked script: the form says what to do.
  expect(await screen.findByText(copy.failedTitle)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: copy.restart }));
  const replacement = document.querySelector<HTMLScriptElement>(
    'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
  );
  expect(replacement).not.toBeNull();
  expect(replacement).not.toBe(failedScript);

  // The real library must create a widget after the replacement script loads.
  const renderWidget = vi.fn<NonNullable<typeof window.turnstile>["render"]>(
    (_container, options) => {
      options?.callback?.("retried-token");
      return "retried-widget";
    },
  );
  vi.stubGlobal("turnstile", { render: renderWidget, remove: vi.fn() });
  await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Captcha token")).toHaveTextContent(
    "retried-token",
  );
  act(() =>
    renderWidget.mock.calls[0]?.[1]?.["expired-callback"]?.("retried-token"),
  );
  fireEvent.click(screen.getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
  expect(document.getElementById(replacement!.id)).toBe(replacement);
  expect(screen.getByLabelText("Captcha token")).toHaveTextContent(
    "retried-token",
  );
  await act(async () => view.unmount());
});
