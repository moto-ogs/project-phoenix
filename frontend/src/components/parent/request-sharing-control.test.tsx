import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ApiError } from "~/lib/api-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ModalProvider } from "~/components/ui/modal-context";
import { catalogText } from "~/test/error-catalog-text";
import {
  getRequestSharing,
  getRequestSharingOptions,
  setRequestSharing,
} from "~/lib/parent-api";
import {
  RequestSharingControl,
  RequestSharingSelector,
} from "./request-sharing-control";
import { ParentResourceTestProvider } from "~/test/parent-resource-provider";
import { useInvalidateFamily } from "~/lib/swr";
import { parentKeys } from "~/lib/swr/parent-keys";

vi.unmock("swr");

function renderParent(ui: Parameters<typeof render>[0]) {
  return render(ui, { wrapper: ParentResourceTestProvider });
}

vi.mock("~/lib/parent-api", () => ({
  getRequestSharing: vi.fn(),
  getRequestSharingOptions: vi.fn(),
  setRequestSharing: vi.fn(),
}));

const getSharing = vi.mocked(getRequestSharing);
const setSharing = vi.mocked(setRequestSharing);
const getOptions = vi.mocked(getRequestSharingOptions);

function renderControl(isSelf = true) {
  return renderParent(
    <ModalProvider>
      <RequestSharingControl
        studentId="42"
        requestType="excused"
        requestId="9"
        isSelf={isSelf}
      />
    </ModalProvider>,
  );
}

describe("RequestSharingControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSharing.mockResolvedValue({
      version: "v1",
      family_protected: false,
      recipients: [
        {
          guardian_profile_id: "7",
          first_name: "Mara",
          last_name: "Muster",
          selected: false,
        },
      ],
    });
    setSharing.mockResolvedValue({
      version: "v1",
      family_protected: false,
      recipients: [],
    });
    getOptions.mockResolvedValue({
      family_protected: false,
      recipients: [
        {
          guardian_profile_id: "7",
          first_name: "Mara",
          last_name: "Muster",
          selected: false,
        },
      ],
    });
  });

  it("is only available to the guardian who submitted the request", async () => {
    const { unmount } = renderControl(false);
    expect(screen.queryByText("Anfrage teilen")).not.toBeInTheDocument();
    unmount();

    renderControl(true);
    // Anker: für die einreichende Person steht dieselbe Aktion da.
    expect(await screen.findByText("Anfrage teilen")).toBeInTheDocument();
  });

  it("initializes a warm remount from the cache and discards cancelled recipient changes on reopening", async () => {
    getSharing.mockResolvedValue({
      version: "v1",
      family_protected: false,
      recipients: [
        {
          guardian_profile_id: "7",
          first_name: "Mara",
          last_name: "Muster",
          selected: true,
        },
      ],
    });
    const control = (show: boolean) => (
      <ModalProvider>
        {show ? (
          <RequestSharingControl
            studentId="42"
            requestType="excused"
            requestId="9"
            isSelf
          />
        ) : null}
      </ModalProvider>
    );
    const { rerender } = renderParent(control(true));
    await screen.findByText("Anfrage teilen");
    rerender(control(false));
    rerender(control(true));
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    const checkbox = await screen.findByRole("checkbox", {
      name: "Mara Muster",
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    expect(
      await screen.findByRole("checkbox", { name: "Mara Muster" }),
    ).toBeChecked();
    fireEvent.click(screen.getByText("Auswahl speichern"));
    await waitFor(() =>
      expect(setSharing).toHaveBeenCalledWith(
        "42",
        "excused",
        "9",
        ["7"],
        "v1",
      ),
    );
    // The opening reads the shared cache; the version guards the save.
    expect(getSharing).toHaveBeenCalledTimes(1);
  });

  // ADR 0311: the choice replaces the whole recipient set, so it carries the
  // version it was made on. A sharing changed since (here: from another
  // device) is refused; the dialog names it without a retry, shows the stored
  // recipients again, and the next choice carries their version.
  it("reloads a sharing changed since it was read instead of retrying the choice", async () => {
    const recipient = {
      guardian_profile_id: "7",
      first_name: "Mara",
      last_name: "Muster",
    };
    getSharing
      .mockResolvedValueOnce({
        version: "v1",
        family_protected: false,
        recipients: [{ ...recipient, selected: true }],
      })
      .mockResolvedValueOnce({
        version: "v2",
        family_protected: false,
        recipients: [{ ...recipient, selected: false }],
      });
    setSharing.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    renderControl();
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    const checkbox = await screen.findByRole("checkbox", {
      name: "Mara Muster",
    });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText("Auswahl speichern"));

    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Auswahl"),
      ),
    ).toBeInTheDocument();
    expect(setSharing).toHaveBeenCalledWith("42", "excused", "9", [], "v1");
    expect(
      within(dialog).queryByRole("button", { name: "Erneut versuchen" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(getSharing).toHaveBeenCalledTimes(2));
    expect(
      await within(dialog).findByRole("checkbox", { name: "Mara Muster" }),
    ).not.toBeChecked();

    fireEvent.click(within(dialog).getByText("Auswahl speichern"));
    await waitFor(() =>
      expect(setSharing).toHaveBeenLastCalledWith(
        "42",
        "excused",
        "9",
        [],
        "v2",
      ),
    );
  });

  // ADR 0311: a newer read arriving while the dialog is open must not
  // replace the parent's ticks. The choice keeps the version it was made on;
  // its refusal then shows the stored recipients.
  it("keeps a touched selection when a newer read arrives and sends its own version", async () => {
    const recipient = {
      guardian_profile_id: "7",
      first_name: "Mara",
      last_name: "Muster",
    };
    const newer = {
      version: "v2",
      family_protected: false,
      // A changed name shows when the newer read has arrived.
      recipients: [{ ...recipient, first_name: "Marta", selected: false }],
    };
    getSharing
      .mockResolvedValueOnce({
        version: "v1",
        family_protected: false,
        recipients: [{ ...recipient, selected: false }],
      })
      .mockResolvedValue(newer);
    setSharing.mockRejectedValueOnce(
      new ApiError("changed since it was read", 409, {
        code: "general.changed_since_read",
      }),
    );
    function BackgroundRead() {
      const invalidate = useInvalidateFamily();
      return (
        <button
          type="button"
          onClick={() =>
            void invalidate(parentKeys.requestSharing("42", "excused", "9"))
          }
        >
          background read
        </button>
      );
    }
    renderParent(
      <ModalProvider>
        <BackgroundRead />
        <RequestSharingControl
          studentId="42"
          requestType="excused"
          requestId="9"
          isSelf
        />
      </ModalProvider>,
    );
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    const dialog = await screen.findByRole("dialog");
    const checkbox = await within(dialog).findByRole("checkbox", {
      name: "Mara Muster",
    });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByText("background read"));
    // The newer read did not overwrite the tick.
    expect(
      await within(dialog).findByRole("checkbox", { name: "Marta Muster" }),
    ).toBeChecked();

    fireEvent.click(within(dialog).getByText("Auswahl speichern"));
    await waitFor(() =>
      expect(setSharing).toHaveBeenCalledWith(
        "42",
        "excused",
        "9",
        ["7"],
        "v1",
      ),
    );
    expect(
      await within(dialog).findByText(
        catalogText("general.changed_since_read", "die Auswahl"),
      ),
    ).toBeInTheDocument();
    // After the refusal the dialog shows the stored sharing.
    await waitFor(() =>
      expect(
        within(dialog).getByRole("checkbox", { name: "Marta Muster" }),
      ).not.toBeChecked(),
    );
  });

  it("saves only the explicitly selected guardian", async () => {
    renderControl();
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    const checkbox = await screen.findByRole("checkbox", {
      name: "Mara Muster",
    });
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByText("Auswahl speichern"));

    await waitFor(() =>
      expect(setSharing).toHaveBeenCalledWith(
        "42",
        "excused",
        "9",
        ["7"],
        "v1",
      ),
    );
  });

  it("offers no recipient choices while family protection is active", async () => {
    getSharing.mockResolvedValue({
      version: "v1",
      family_protected: true,
      recipients: [],
    });
    renderControl();
    expect(
      await screen.findByText(
        "Diese Anfrage bleibt privat. Die OGS hat den Familienschutz eingeschaltet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Anfrage teilen")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  // Faellt der Abruf der Empfaenger aus, blockiert das die Anfrage nicht: der
  // Hinweis erklaert es, und die Auswahl wird als leer gemeldet (#2267).
  it("explains a failed recipient load and reports no recipients", async () => {
    getOptions.mockRejectedValue(
      new ApiError("diag", 503, { code: "general.unavailable" }),
    );
    const onChange = vi.fn();
    renderParent(
      <RequestSharingSelector
        studentId="42"
        selected={["7"]}
        onChange={onChange}
      />,
    );

    expect(
      await screen.findByText(
        `${catalogText("general.unavailable", "die Liste der Empfänger")} Du kannst die Anfrage trotzdem senden und später teilen.`,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([]));
  });

  it("retries a failed recipient load in place", async () => {
    getOptions.mockRejectedValueOnce(
      new ApiError("diag", 503, { code: "general.unavailable" }),
    );
    renderParent(
      <RequestSharingSelector
        studentId="42"
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Wiederholen" }));

    expect(
      await screen.findByRole("checkbox", { name: "Mara Muster" }),
    ).toBeInTheDocument();
    expect(getOptions).toHaveBeenCalledTimes(2);
  });

  it("shows a failed sharing load next to the request with a retry", async () => {
    getSharing.mockRejectedValueOnce(
      new ApiError("diag", 503, { code: "general.unavailable" }),
    );
    renderControl();

    expect(
      await screen.findByText(
        catalogText("general.unavailable", "die Liste der Empfänger"),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Wiederholen" }));
    expect(await screen.findByText("Anfrage teilen")).toBeInTheDocument();
  });

  it("keeps a failed save inside the sharing dialog", async () => {
    setSharing.mockRejectedValueOnce(
      new ApiError("diag", 400, { code: "care.request_sharing_invalid" }),
    );
    renderControl();
    fireEvent.click(await screen.findByText("Anfrage teilen"));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Mara Muster" }),
    );
    fireEvent.click(screen.getByText("Auswahl speichern"));

    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(
        catalogText("care.request_sharing_invalid", "die Auswahl"),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/diag/)).not.toBeInTheDocument();
  });

  it("shows named recipients before a request is submitted", async () => {
    renderParent(
      <RequestSharingSelector
        studentId="42"
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("checkbox", { name: "Mara Muster" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Anfrage teilen (optional)")).toBeVisible();
    expect(
      screen.getByText(
        "Nur ausgewählte Sorgeberechtigte sehen deine Anfrage und die Antwort der OGS.",
      ),
    ).toBeVisible();
  });

  // Die Produkt-Screenshots warten, solange ein Element aria-busy trägt
  // (scripts/product-screenshots/capture.ts).
  it("marks the recipient loading line as busy", () => {
    getOptions.mockReturnValue(new Promise(() => undefined));
    renderParent(
      <RequestSharingSelector
        studentId="42"
        selected={[]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("Empfänger werden geladen …")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});
