vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "account-1", tenantId: 1, scope: "tenant" },
      expires: "2099-01-01",
    },
    status: "authenticated",
  }),
}));
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

// Der Reiter lädt über authService; hier zählt nur, dass der Detailbereich
// ihn mit dem Bearbeiten-Zustand des offenen Reiters versorgt.
vi.mock("~/components/roles/role-permissions-tab", () => ({
  RolePermissionsTab: ({
    editing,
    onCancelEdit,
  }: {
    editing: boolean;
    onCancelEdit: () => void;
  }) => (
    <div data-testid="role-permissions-tab" data-editing={editing}>
      {editing ? (
        <button type="button" onClick={onCancelEdit}>
          Abbrechen
        </button>
      ) : null}
    </div>
  ),
}));

import { RolesMasterDetail } from "./roles-master-detail";
import type { Role } from "@/lib/auth-helpers";
import { ApiError } from "~/lib/api-error";

const customRole: Role = {
  id: "1",
  name: "Vertretungslehrkraft",
  description: "Vertritt im Krankheitsfall",
  isSystem: false,
  baseRole: "teacher",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
  version: "v1",
  permissionNames: ["permission.read"],
};

const systemRole: Role = {
  id: "2",
  name: "admin",
  description: "Administrator",
  isSystem: true,
  baseRole: "admin",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
};

const unclassifiedRole: Role = {
  id: "3",
  name: "Helfer",
  description: "",
  isSystem: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
};

/**
 * The page around the detail: a read puts the role it read into the shown
 * role, as the page's cache does.
 */
function Page({
  initial,
  onSave,
  reload,
}: {
  initial: Role;
  onSave: (data: Partial<Role>, base: Role) => Promise<Role>;
  reload: () => Promise<Role>;
}) {
  const [role, setRole] = useState(initial);
  return (
    <RolesMasterDetail
      roles={[role]}
      selectedId={role.id}
      selectedRole={role}
      detailLoading={false}
      onSelect={() => undefined}
      onSaveRole={async (data, base) => {
        const saved = await onSave(data, base);
        setRole(saved);
        return saved;
      }}
      onReloadRole={async () => {
        const read = await reload();
        setRole(read);
        return read;
      }}
      onDeleteClick={() => undefined}
      onPermissionsSaved={() => undefined}
    />
  );
}

describe("RolesMasterDetail", () => {
  const onSelect = vi.fn();
  const onSaveRole = vi.fn(async (_data: Partial<Role>, base: Role) => base);
  const onReloadRole = vi.fn(async () => customRole);
  const onDeleteClick = vi.fn();
  const onPermissionsSaved = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the empty detail state when nothing is selected", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId={null}
        selectedRole={null}
        detailLoading={false}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(screen.queryByText("Bearbeiten")).not.toBeInTheDocument();
    expect(screen.getByText("Vertretungslehrkraft")).toBeInTheDocument();
  });

  it("renders the selected role detail with permissions count and base role", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(screen.getAllByText("Vertretungslehrkraft").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("1 Berechtigung")).toBeInTheDocument();
  });

  it("opens the inline edit form and triggers delete for non-system roles", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        canManagePermissions
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    fireEvent.click(screen.getByText("Löschen"));
    expect(onDeleteClick).toHaveBeenCalled();

    // Berechtigungen sind ein zweiter Reiter, kein Knopf im Kopf (#3116).
    expect(
      screen.queryByRole("button", { name: /^Berechtigungen$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Berechtigungen" }),
    ).toBeInTheDocument();

    // Bearbeitet wird im Detailbereich, nicht in einem Modal daneben: der
    // Knopf schaltet das Formular ein, mit Speichern und Abbrechen unten.
    fireEvent.click(screen.getByText("Bearbeiten"));
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Abbrechen" }),
    ).toBeInTheDocument();
  });

  it("switches the permissions tab into its own edit state", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        canManagePermissions
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    // Radix Tabs aktivieren auf mousedown, nicht auf click.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Berechtigungen" }), {
      button: 0,
    });
    const tab = screen.getByTestId("role-permissions-tab");
    expect(tab).toHaveAttribute("data-editing", "false");

    fireEvent.click(screen.getByText("Bearbeiten"));
    expect(screen.getByTestId("role-permissions-tab")).toHaveAttribute(
      "data-editing",
      "true",
    );
    // Der Kopf zeigt im Bearbeiten-Zustand weder Bearbeiten noch Löschen.
    expect(screen.queryByText("Löschen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.getByTestId("role-permissions-tab")).toHaveAttribute(
      "data-editing",
      "false",
    );
    expect(screen.getByText("Bearbeiten")).toBeInTheDocument();
  });

  it("hides permissions without permission access", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(
      screen.queryByRole("tab", { name: "Berechtigungen" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Löschen")).toBeInTheDocument();
  });

  it("ends the edit state when the tab changes", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        canManagePermissions
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    fireEvent.click(screen.getByText("Bearbeiten"));
    expect(
      screen.getByRole("button", { name: "Speichern" }),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Berechtigungen" }), {
      button: 0,
    });
    expect(screen.getByTestId("role-permissions-tab")).toHaveAttribute(
      "data-editing",
      "false",
    );
    expect(screen.getByText("Bearbeiten")).toBeInTheDocument();
  });

  // ADR 0311: the edit rests on the role's version. A refusal shows the
  // stored role, and the next save goes out over its version.
  it("shows the stored role after a refusal and saves over its version", async () => {
    const stored: Role = {
      ...customRole,
      description: "Von der Kollegin geändert",
      version: "v2",
    };
    const save = vi
      .fn<(data: Partial<Role>, base: Role) => Promise<Role>>()
      .mockRejectedValueOnce(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      )
      .mockImplementation(async (data, base) => ({
        ...base,
        ...data,
        version: "v3",
      }));
    render(
      <Page
        initial={customRole}
        onSave={save}
        reload={() => Promise.resolve(stored)}
      />,
    );
    fireEvent.click(screen.getByText("Bearbeiten"));
    fireEvent.change(screen.getByLabelText("Beschreibung"), {
      target: { value: "Mein Entwurf" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Beschreibung")).toHaveValue(
        "Von der Kollegin geändert",
      ),
    );
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "Mein Entwurf" }),
      expect.objectContaining({ id: "1", version: "v1" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({ description: "Von der Kollegin geändert" }),
        expect.objectContaining({ version: "v2" }),
      ),
    );
  });

  // ADR 0311 rule 6: after a refusal whose read fails, nothing is sent.
  it("keeps Speichern locked after a refusal until the stored role is read", async () => {
    const save = vi.fn(() =>
      Promise.reject(
        new ApiError("changed", 409, { code: "general.changed_since_read" }),
      ),
    );
    render(
      <Page
        initial={customRole}
        onSave={save}
        reload={() =>
          Promise.reject(
            new ApiError("down", 503, { code: "general.unavailable" }),
          )
        }
      />,
    );
    fireEvent.click(screen.getByText("Bearbeiten"));
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    // Locked with its reason (aria-disabled keeps the reason reachable).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Speichern" })).toHaveAttribute(
        "aria-disabled",
        "true",
      ),
    );
    expect(
      screen.getByText("Lade zuerst den gespeicherten Stand neu."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("hides edit, delete, and permission actions for system roles", () => {
    render(
      <RolesMasterDetail
        roles={[systemRole]}
        selectedId="2"
        selectedRole={systemRole}
        detailLoading={false}
        canManagePermissions
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(screen.queryByText("Bearbeiten")).not.toBeInTheDocument();
    expect(screen.queryByText("Löschen")).not.toBeInTheDocument();
    // Die Berechtigungen einer Systemrolle bleiben ansehbar.
    expect(
      screen.getByRole("tab", { name: "Berechtigungen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Vorgegebene Rollen gelten für alle Schulen. Sie können nicht bearbeitet oder gelöscht werden.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the 'Zuordnung fehlt' chip for roles without a base role", () => {
    render(
      <RolesMasterDetail
        roles={[unclassifiedRole]}
        selectedId="3"
        selectedRole={unclassifiedRole}
        detailLoading={false}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(screen.getByText("Zuordnung fehlt")).toBeInTheDocument();
  });

  it("groups roles under a single 'Alle Rollen' bucket and renders a Stammdaten tab", () => {
    render(
      <RolesMasterDetail
        roles={[customRole, systemRole, unclassifiedRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={false}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(screen.getByText("Alle Rollen")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Stammdaten" })).toBeInTheDocument();
  });

  it("renders the loading spinner instead of role data while detailLoading is true", () => {
    render(
      <RolesMasterDetail
        roles={[customRole]}
        selectedId="1"
        selectedRole={customRole}
        detailLoading={true}
        onSelect={onSelect}
        onSaveRole={onSaveRole}
        onReloadRole={onReloadRole}
        onDeleteClick={onDeleteClick}
        onPermissionsSaved={onPermissionsSaved}
      />,
    );

    expect(
      screen.getByText("Rollendaten werden geladen..."),
    ).toBeInTheDocument();
    // The Stammdaten data fields must NOT render while loading. "Berechtigungen"
    // is the InfoSection-only label for the permission count grid; the header
    // subtitle has its own count chip.
    expect(screen.queryByText("Rollendetails")).not.toBeInTheDocument();
  });
});
