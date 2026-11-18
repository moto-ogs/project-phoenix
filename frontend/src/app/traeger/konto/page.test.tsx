import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraegerResourceTestProvider } from "~/test/traeger-resource-provider";
import { ApiError } from "~/lib/api-error";

vi.unmock("swr");
const api = vi.hoisted(() => ({
  fetchTraegerProfile: vi.fn(),
  changeTraegerProfileName: vi.fn(),
}));

vi.mock("~/lib/traeger-api", () => api);
// The device list has its own tests and needs a session provider.
vi.mock("~/components/settings/trusted-devices-section", () => ({
  TrustedDevicesSection: ({ scope }: { scope: string }) => (
    <section aria-label={`Vertraute Geräte (${scope})`} />
  ),
}));

import TraegerAccountPage from "./page";

const PROFILE = {
  accountId: "4",
  email: "kasse@traeger.example",
  name: "",
};

function renderPage() {
  return render(
    <TraegerResourceTestProvider>
      <TraegerAccountPage />
    </TraegerResourceTestProvider>,
  );
}

describe("TraegerAccountPage", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchTraegerProfile.mockResolvedValue(PROFILE);
  });

  it("shows the sign-in address and saves the own name", async () => {
    api.changeTraegerProfileName.mockResolvedValue({
      ...PROFILE,
      name: "Karl Kasse",
    });
    renderPage();
    expect(
      await screen.findByRole("region", { name: "Vertraute Geräte (traeger)" }),
    ).toBeInTheDocument();

    expect(
      await screen.findByText("kasse@traeger.example"),
    ).toBeInTheDocument();
    // Read first, like the profile page of the school app (#7416): no field,
    // no save, until „Bearbeiten“.
    expect(
      screen.queryByRole("textbox", { name: /Dein Name/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    const field = screen.getByRole("textbox", { name: /Dein Name/ });
    expect(field).toHaveValue("");

    fireEvent.change(field, { target: { value: " Karl Kasse " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(api.changeTraegerProfileName).toHaveBeenCalledWith("Karl Kasse"),
    );
    expect(
      await screen.findByText("Dein Name ist gespeichert."),
    ).toBeInTheDocument();
    // Back in the read state with what the backend keeps (trimmed).
    expect(await screen.findByText("Karl Kasse")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /Dein Name/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Speichern" }),
    ).not.toBeInTheDocument();
  });

  it("drops the draft on „Abbrechen“", async () => {
    api.fetchTraegerProfile.mockResolvedValue({ ...PROFILE, name: "Karl" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Dein Name/ }), {
      target: { value: "Kurt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(screen.getByText("Karl")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /Dein Name/ }),
    ).not.toBeInTheDocument();
    expect(api.changeTraegerProfileName).not.toHaveBeenCalled();
  });

  it("asks for a name before it saves", async () => {
    api.fetchTraegerProfile.mockResolvedValue({ ...PROFILE, name: "Karl" });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Dein Name/ }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    expect(
      (await screen.findAllByText("Bitte gib deinen Namen ein."))[0],
    ).toBeInTheDocument();
    expect(api.changeTraegerProfileName).not.toHaveBeenCalled();
  });

  it("shows the backend's refusal at the field", async () => {
    api.changeTraegerProfileName.mockRejectedValue(
      new ApiError("Bad Request", 400, {
        code: "general.input",
        errors: [{ field: "name", reason: "invalid" }],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Dein Name/ }), {
      target: { value: "Karl\u0007" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: /Dein Name/ }),
      ).toHaveAttribute("aria-invalid", "true"),
    );
    // The draft stays for a correction.
    expect(screen.getByRole("textbox", { name: /Dein Name/ })).toHaveValue(
      "Karl\u0007",
    );
  });

  it("shows a load error instead of the cards", async () => {
    api.fetchTraegerProfile.mockRejectedValue(
      new ApiError("Unavailable", 503, { code: "general.unavailable" }),
    );
    renderPage();

    expect((await screen.findAllByRole("alert"))[0]).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /Dein Name/ }),
    ).not.toBeInTheDocument();
  });
});
