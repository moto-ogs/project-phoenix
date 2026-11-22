import { act, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Lässt ein Blatt von unten (`ResponsivePanel` am Telefon) fertig schließen.
 * Vaul hält es bis zum Ende seiner Animation im DOM; happy-dom spielt keine,
 * darum meldet der Helfer ihr Ende selbst.
 */
export async function finishSheetClosing(name: string): Promise<void> {
  const sheet = screen.queryByRole("dialog", { name });
  if (sheet !== null) {
    await waitFor(() => expect(sheet).toHaveAttribute("data-state", "closed"));
    const end = new Event("animationend");
    Object.assign(end, {
      animationName: getComputedStyle(sheet).animationName,
    });
    act(() => {
      sheet.dispatchEvent(end);
    });
  }
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name })).not.toBeInTheDocument(),
  );
}
