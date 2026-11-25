/**
 * Tests for AccountsTable.
 *
 * Covers showSchool toggle, capability column variations, status badge
 * fallback, and server sorting triggered by the column headers.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { AccountsTable } from "./accounts-table";
import type {
  OrgAccount,
  SchoolAccount,
} from "~/lib/operator/provisioning-helpers";

function makeSchoolAccount(
  overrides: Partial<SchoolAccount> = {},
): SchoolAccount {
  return {
    accountId: "1",
    email: "anna@example.com",
    active: true,
    firstName: "Anna",
    lastName: "Beispiel",
    roleName: "Lehrer",
    pedagogicRole: "Klassenlehrer",
    status: "active",
    hasAdminRole: false,
    hasUserRole: true,
    hasCaregiverProfile: false,
    isActiveCaregiver: false,
    ...overrides,
  };
}

function makeOrgAccount(overrides: Partial<OrgAccount> = {}): OrgAccount {
  return {
    ...makeSchoolAccount(),
    schoolId: "10",
    schoolName: "Test School",
    ...overrides,
  };
}

describe("AccountsTable", () => {
  it("renders name, email, role, and pedagogic role for each account", () => {
    render(<AccountsTable accounts={[makeSchoolAccount()]} />);

    expect(screen.getByText("Anna Beispiel")).toBeInTheDocument();
    expect(screen.getByText("anna@example.com")).toBeInTheDocument();
    expect(screen.getByText("Lehrer")).toBeInTheDocument();
    expect(screen.getByText("Klassenlehrer")).toBeInTheDocument();
  });

  it("renders the Schule column when showSchool is set", () => {
    render(<AccountsTable accounts={[makeOrgAccount()]} showSchool />);

    expect(screen.getByText("Schule")).toBeInTheDocument();
    expect(screen.getByText("Test School")).toBeInTheDocument();
  });

  it("falls back to em dash when role and pedagogic role are empty", () => {
    render(
      <AccountsTable
        accounts={[makeSchoolAccount({ roleName: "", pedagogicRole: "" })]}
      />,
    );

    expect(screen.getAllByText("–").length).toBeGreaterThanOrEqual(2);
  });

  it("renders an empty state when no accounts are passed", () => {
    render(<AccountsTable accounts={[]} />);

    // AccountsTable does not pass a custom emptyState → DataTable falls
    // back to its default placeholder.
    expect(screen.getByText("Keine Einträge vorhanden.")).toBeInTheDocument();
  });

  it("falls back for inherited status-map keys", () => {
    render(
      <AccountsTable
        accounts={[makeSchoolAccount({ status: "constructor" })]}
      />,
    );

    expect(screen.getByText("constructor")).toHaveStyle({
      backgroundColor: "#F3F4F6",
      color: "#4B5563",
    });
  });

  it.each([
    [/^Rolle – /, "roleName"],
    [/^Päd\. Rolle – /, "pedagogicRole"],
  ] as const)(
    "requests server sorting for %s without reordering the page",
    (name, key) => {
      const onChange = vi.fn();
      render(
        <AccountsTable
          serverSort={{ key: "name", direction: "asc", onChange }}
          accounts={[
            makeSchoolAccount({
              accountId: "1",
              firstName: "Anna",
              lastName: "A",
              roleName: "Z",
              pedagogicRole: "Z",
            }),
            makeSchoolAccount({
              accountId: "2",
              firstName: "Ben",
              lastName: "B",
              roleName: "A",
              pedagogicRole: "A",
            }),
          ]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name }));

      expect(onChange).toHaveBeenCalledWith({ key, direction: "asc" });
      expect(
        screen
          .getAllByRole("row")
          .slice(1)
          .map((row) => row.textContent),
      ).toEqual([
        expect.stringContaining("Anna A"),
        expect.stringContaining("Ben B"),
      ]);
    },
  );
});
