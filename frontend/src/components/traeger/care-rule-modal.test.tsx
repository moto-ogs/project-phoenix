import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import { ApiError } from "~/lib/api-error";
import { catalogText } from "~/test/error-catalog-text";
import type { CareRule, CareRuleSet } from "~/lib/traeger-care-reductions-api";
import { CareRuleModal } from "./care-rule-modal";

const { saveCareRule } = vi.hoisted(() => ({ saveCareRule: vi.fn() }));
vi.mock("~/lib/traeger-care-reductions-api", () => ({ saveCareRule }));

const rule: CareRule = {
  version: "v1",
  id: "7",
  kind: "sibling",
  name: "Geschwister",
  validFrom: "2026-09-01",
  validUntil: null,
  schoolIds: ["11"],
  careOfferingIds: ["999"],
  countSchoolIds: [],
  siblingFromChild: 2,
  discountBasisPoints: 5000,
  discountCents: null,
  priceCents: null,
  capCents: null,
  countsFamilyChildren: false,
};
const data: CareRuleSet = {
  rules: [rule],
  schools: [{ id: "11", name: "Schule" }],
  modules: [],
};

describe("CareRuleModal", () => {
  it("preserves module restrictions missing from the current choices when renaming", async () => {
    saveCareRule.mockResolvedValue(data);
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Name auf der Rechnung/), {
      target: { value: "Geschwister neu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() =>
      expect(saveCareRule).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({
          name: "Geschwister neu",
          careOfferingIds: ["999"],
        }),
        "v1",
      ),
    );
  });

  it("counts the family's children while preserving the price-list effect", async () => {
    saveCareRule.mockResolvedValue(data);
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{
            kind: "sibling",
            rule: {
              ...rule,
              discountBasisPoints: null,
              tariffSiblingPrice: true,
            },
          }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    const toggle = screen.getByRole("switch", {
      name: /Geschwister ohne Vertrag mitzählen/,
    });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() =>
      expect(saveCareRule).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({
          countsFamilyChildren: true,
          tariffSiblingPrice: true,
          discountBasisPoints: null,
        }),
        "v1",
      ),
    );
  });
  it("keeps a rank rule a rank rule and says whom it reduces", async () => {
    saveCareRule.mockResolvedValue(data);
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByText(
        /Das 1\. Kind zahlt den vollen Beitrag\. Ab dem 2\. Kind/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() =>
      expect(saveCareRule).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({
          siblingFromChild: 2,
          siblingAllChildren: false,
        }),
        "v1",
      ),
    );
  });

  it("reduces every child of a family from a size on (#7765)", async () => {
    saveCareRule.mockResolvedValue(data);
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Alle Kinder der Familie" }),
    );
    // Without the family's number only children with a contract count:
    // the form says so where the choice is made.
    expect(
      screen.getByText(
        /mindestens 2 Kinder, zahlt jedes ihrer Kinder mit Vertrag weniger, auch das erste\. Im Moment zählen nur Kinder mit Vertrag/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Ab so vielen Kindern/)).toHaveValue("2");
    fireEvent.click(
      screen.getByRole("switch", {
        name: /Geschwister ohne Vertrag mitzählen/,
      }),
    );
    expect(
      screen.queryByText(/Im Moment zählen nur Kinder mit Vertrag/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() =>
      expect(saveCareRule).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({
          siblingFromChild: 2,
          siblingAllChildren: true,
          countsFamilyChildren: true,
        }),
        "v1",
      ),
    );
  });

  it("opens a family-size rule in its mode", () => {
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{
            kind: "sibling",
            rule: { ...rule, siblingFromChild: 3, siblingAllChildren: true },
          }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Alle Kinder der Familie" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/Ab so vielen Kindern/)).toHaveValue("3");
  });

  // #7863: the rule's own schools always count; the field adds others.
  const twoSchools: CareRuleSet = {
    ...data,
    schools: [
      { id: "11", name: "Schule" },
      { id: "12", name: "Nachbarschule" },
    ],
  };

  it("says that the rule's schools always count and offers only the others", () => {
    render(
      <ToastProvider>
        <CareRuleModal
          data={twoSchools}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    const field = screen.getByRole("combobox", {
      name: "Geschwister zählen auch an",
    });
    expect(field).toHaveTextContent("Keine weitere Schule");
    expect(
      screen.getByText(
        "Die Schulen der Regel zählen immer. Wähle hier weitere Schulen, deren Kinder mitzählen.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(field);
    expect(
      screen.getByRole("option", { name: "Nachbarschule" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("drops the rule's own schools from a stored choice when saving", async () => {
    saveCareRule.mockResolvedValue(twoSchools);
    render(
      <ToastProvider>
        <CareRuleModal
          data={twoSchools}
          open={{
            kind: "sibling",
            rule: { ...rule, countSchoolIds: ["11", "12"] },
          }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByRole("combobox", { name: "Geschwister zählen auch an" }),
    ).toHaveTextContent("Nachbarschule");
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() =>
      expect(saveCareRule).toHaveBeenCalledWith(
        "7",
        expect.objectContaining({ schoolIds: ["11"], countSchoolIds: ["12"] }),
        "v1",
      ),
    );
  });

  it("explains a rule that already applies at every school", () => {
    render(
      <ToastProvider>
        <CareRuleModal
          data={data}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={async () => data}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>,
    );
    expect(
      screen.getByRole("combobox", { name: "Geschwister zählen auch an" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "Die Schulen der Regel zählen immer. Es gibt keine weitere Schule.",
      ),
    ).toBeInTheDocument();
  });

  // ADR 0311: a colleague changed the rule since the list was read. The
  // save sent the version the form started from, is refused, and the rule
  // is read again: the form shows the colleague's rule instead of the
  // draft, and the next save sends the new version.
  it("shows the rule a colleague saved since instead of keeping the draft", async () => {
    saveCareRule.mockRejectedValueOnce(
      new ApiError("changed", 409, { code: "general.changed_since_read" }),
    );
    const stored: CareRuleSet = {
      ...data,
      rules: [{ ...rule, name: "Geschwister Kollegin", version: "v2" }],
    };
    const reload = vi.fn(() => Promise.resolve(stored));
    const modal = (rules: CareRuleSet) => (
      <ToastProvider>
        <CareRuleModal
          data={rules}
          open={{ kind: "sibling", rule }}
          currentMonth="2026-09-01"
          reload={reload}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      </ToastProvider>
    );
    const { rerender } = render(modal(data));
    fireEvent.change(screen.getByLabelText(/Name auf der Rechnung/), {
      target: { value: "Geschwister neu" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));

    expect(
      await screen.findByText(
        catalogText("general.changed_since_read", "die Regel"),
      ),
    ).toBeInTheDocument();
    expect(saveCareRule.mock.calls.at(-1)?.[2]).toBe("v1");
    expect(reload).toHaveBeenCalledTimes(1);

    // The page reads the rules again; they arrive as `data` as well.
    rerender(modal(stored));
    await waitFor(() =>
      expect(screen.getByLabelText(/Name auf der Rechnung/)).toHaveValue(
        "Geschwister Kollegin",
      ),
    );
    saveCareRule.mockResolvedValueOnce(stored);
    fireEvent.click(screen.getByRole("button", { name: "Regel speichern" }));
    await waitFor(() => expect(saveCareRule.mock.calls.at(-1)?.[2]).toBe("v2"));
  });
});
