import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { CareRule, CareRuleSet } from "~/lib/traeger-care-reductions-api";
import { CareRuleModal } from "./care-rule-modal";

const { saveCareRule } = vi.hoisted(() => ({ saveCareRule: vi.fn() }));
vi.mock("~/lib/traeger-care-reductions-api", () => ({ saveCareRule }));

const rule: CareRule = {
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
});
