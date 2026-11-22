import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "~/lib/api-error";
import type { ChildLinkRow } from "~/lib/traeger-contract-child-links-api";
import { ToastProvider } from "~/contexts/ToastContext";
import { catalogText } from "~/test/error-catalog-text";
import { CareContractChildLinkModal } from "./care-contract-child-link-modal";

const api = vi.hoisted(() => ({
  previewContractChildLink: vi.fn(),
  linkContractChild: vi.fn(),
}));
vi.mock("~/lib/traeger-contract-child-links-api", async (original) => ({
  ...(await original<object>()),
  ...api,
}));
vi.mock("~/lib/traeger-url", () => ({ traegerPath: (path: string) => path }));

function row(overrides: Partial<ChildLinkRow> = {}): ChildLinkRow {
  return {
    line: 1,
    status: "ready",
    contractId: "75",
    studentId: "12",
    schoolName: "OGS Sonnenhof",
    contract: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    student: {
      firstName: "Mia",
      lastName: "Beispiel",
      birthDate: "2018-05-03",
    },
    problems: [],
    repeatsLine: null,
    otherContractId: null,
    fingerprint: "fp-preview",
    ...overrides,
  };
}

function open(onLinked = vi.fn()) {
  render(
    <ToastProvider>
      <CareContractChildLinkModal
        contractId="75"
        isOpen
        onClose={vi.fn()}
        onLinked={onLinked}
      />
    </ToastProvider>,
  );
  return onLinked;
}

async function check(number: string) {
  fireEvent.change(screen.getByLabelText(/Nummer der Kinderakte/), {
    target: { value: number },
  });
  fireEvent.click(screen.getByRole("button", { name: "Prüfen" }));
}

describe("Einen Vertrag mit der Kinderakte verknüpfen", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("compares both sides before it links a matching child record", async () => {
    const onLinked = open();
    api.previewContractChildLink.mockResolvedValueOnce(row());
    await check("12");
    expect(await screen.findByText("Im Vertrag steht")).toBeInTheDocument();
    expect(screen.getByText("In der Kinderakte steht")).toBeInTheDocument();
    expect(api.previewContractChildLink).toHaveBeenCalledWith("75", "12");
    expect(api.linkContractChild).not.toHaveBeenCalled();

    api.linkContractChild.mockResolvedValueOnce(row({ status: "stored" }));
    fireEvent.click(screen.getByRole("button", { name: "Verknüpfen" }));
    await waitFor(() => expect(onLinked).toHaveBeenCalledOnce());
    expect(api.linkContractChild).toHaveBeenCalledWith(
      "75",
      "12",
      false,
      "fp-preview",
    );
  });

  it("names the difference and links only with the deliberate confirmation", async () => {
    open();
    api.previewContractChildLink.mockResolvedValueOnce(
      row({
        status: "conflict",
        student: {
          firstName: "Mia",
          lastName: "Beispiel",
          birthDate: "2018-05-30",
        },
        problems: [{ field: "child", code: "differs" }],
      }),
    );
    await check("12");
    expect(
      await screen.findByText("Geburtsdatum weicht ab"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Weicht ab")).toHaveLength(2);
    api.linkContractChild.mockResolvedValueOnce(row({ status: "stored" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Trotzdem verknüpfen" }),
    );
    await waitFor(() =>
      expect(api.linkContractChild).toHaveBeenCalledWith(
        "75",
        "12",
        true,
        "fp-preview",
      ),
    );
  });

  it("explains any other problem and offers no link", async () => {
    open();
    api.previewContractChildLink.mockResolvedValueOnce(
      row({
        status: "conflict",
        otherContractId: "9",
        problems: [{ field: "child", code: "has_contract" }],
      }),
    );
    await check("12");
    expect(
      await screen.findByText(/schon einen anderen laufenden Vertrag/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Anderen Vertrag öffnen/ }),
    ).toHaveAttribute("href", "/traeger/vertraege/9");
    expect(screen.getByRole("button", { name: "Verknüpfen" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("marks an unknown child record at the field and focuses it", async () => {
    open();
    api.previewContractChildLink.mockResolvedValueOnce(
      row({
        status: "invalid",
        student: null,
        problems: [{ field: "child", code: "unknown" }],
      }),
    );
    await check("999");
    expect(
      await screen.findByText(
        "Die Schule des Vertrags hat keine Kinderakte mit dieser Nummer.",
      ),
    ).toBeInTheDocument();
    const field = screen.getByLabelText(/Nummer der Kinderakte/);
    expect(field).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(field).toHaveFocus());
    expect(screen.queryByText("Im Vertrag steht")).not.toBeInTheDocument();
  });

  it("checks the number before it asks the backend", async () => {
    open();
    await check("12a");
    expect(
      await screen.findByText("Nur Ziffern, zum Beispiel 123."),
    ).toBeInTheDocument();
    expect(api.previewContractChildLink).not.toHaveBeenCalled();
  });

  it("shows the fresh comparison when the child record changed since the check", async () => {
    open();
    api.previewContractChildLink.mockResolvedValueOnce(row());
    await check("12");
    await screen.findByText("Im Vertrag steht");
    api.linkContractChild.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.child_link_changed",
      }),
    );
    api.previewContractChildLink.mockResolvedValueOnce(
      row({
        status: "conflict",
        fingerprint: "fp-fresh",
        student: {
          firstName: "Mia",
          lastName: "Beispiel",
          birthDate: "2018-05-30",
        },
        problems: [{ field: "child", code: "differs" }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Verknüpfen" }));
    expect(
      await screen.findByText(
        catalogText("care_contract.child_link_changed", "die Verknüpfung"),
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Geburtsdatum weicht ab"),
    ).toBeInTheDocument();

    api.linkContractChild.mockResolvedValueOnce(row({ status: "stored" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Trotzdem verknüpfen" }),
    );
    await waitFor(() =>
      expect(api.linkContractChild).toHaveBeenLastCalledWith(
        "75",
        "12",
        true,
        "fp-fresh",
      ),
    );
  });

  it("shows the current comparison when the link was refused", async () => {
    open();
    api.previewContractChildLink.mockResolvedValueOnce(row());
    await check("12");
    await screen.findByText("Im Vertrag steht");
    api.linkContractChild.mockRejectedValueOnce(
      new ApiError("Request failed (409)", 409, {
        code: "care_contract.child_link_refused",
      }),
    );
    api.previewContractChildLink.mockResolvedValueOnce(
      row({
        status: "conflict",
        problems: [{ field: "contract", code: "linked_other" }],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Verknüpfen" }));
    expect(
      await screen.findByText(
        "Der Vertrag ist schon mit einer anderen Kinderakte verknüpft. Löse zuerst diese Verknüpfung.",
      ),
    ).toBeInTheDocument();
  });
});
