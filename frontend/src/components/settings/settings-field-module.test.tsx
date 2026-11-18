import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "~/contexts/ToastContext";
import type { ResolvedSetting } from "~/lib/settings-api";
import { SettingsField } from "./settings-field";

function moduleSetting(
  overrides: Partial<ResolvedSetting> = {},
): ResolvedSetting {
  return {
    key: "module.zeiterfassung",
    label: "Zeiterfassung",
    description:
      "Stempeluhr, Arbeitszeitmodelle, Urlaub und Export für das Lohnbüro.",
    type: "boolean",
    default: true,
    value: true,
    is_default: true,
    writable: false,
    visible: true,
    sort_order: 6,
    access_policy: "operator_managed",
    levels: "schule",
    source: "default",
    validation: null,
    depends_on: null,
    options: null,
    ...overrides,
  };
}

function renderField(
  setting: ResolvedSetting,
  audience: "admin" | "operator" = "admin",
) {
  return render(
    <ToastProvider>
      <SettingsField
        setting={setting}
        audience={audience}
        onSave={vi.fn()}
        onReset={vi.fn()}
      />
    </ToastProvider>,
  );
}

// A module switch (#4892) names the booking, not a retention window.
describe("SettingsField for a module switch", () => {
  it("tells the school that the moto team changes its modules", () => {
    const { getByText, queryByText, getByRole } = renderField(moduleSetting());

    expect(getByText("Nur Lesen")).toBeInTheDocument();
    expect(
      getByText(
        "Welche Module Ihre Schule hat, steht im Vertrag mit moto. Für eine Änderung wenden Sie sich an das moto-Team.",
      ),
    ).toBeInTheDocument();
    expect(queryByText(/Frist/)).not.toBeInTheDocument();
    expect(getByRole("switch", { name: "Zeiterfassung" })).toBeDisabled();
  });

  it("tells the moto team that the school only sees the booking", () => {
    const { getByText, queryByText } = renderField(
      moduleSetting({ writable: true }),
      "operator",
    );

    expect(
      getByText(
        "Gebuchtes Modul aus dem Vertrag. Die Schule sieht es, kann es aber nicht ändern.",
      ),
    ).toBeInTheDocument();
    expect(queryByText(/Löschfrist/)).not.toBeInTheDocument();
  });
});

// #4803: an operator-managed switch that is neither a module nor a retention
// window says only who decides it, never „Löschfrist“.
describe("SettingsField for another operator-managed switch", () => {
  it("names the moto team without calling it a deletion period", () => {
    const { getByText, queryByText } = renderField(
      moduleSetting({
        key: "operations.children_without_care_place",
        label: "Kinder ohne OGS-Platz in der Eltern-App",
        default: false,
        value: true,
        writable: true,
      }),
      "operator",
    );

    expect(
      getByText(
        "Legt das moto-Team mit der Schule fest. Die Schule sieht es, kann es aber nicht ändern.",
      ),
    ).toBeInTheDocument();
    expect(queryByText(/Löschfrist|Gebuchtes Modul/)).not.toBeInTheDocument();
  });

  it("keeps the deletion period note for a retention window", () => {
    const { getByText } = renderField(
      moduleSetting({
        key: "gdpr.status_day_retention_days",
        label: "Krank- und Entschuldigt-Tage aufbewahren",
        type: "number",
        default: 30,
        value: 30,
        writable: true,
      }),
      "operator",
    );

    expect(
      getByText(
        "Löschfrist aus dem Vertrag. Die Schule sieht sie, kann sie aber nicht ändern.",
      ),
    ).toBeInTheDocument();
  });
});
