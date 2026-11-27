"use client";

// Role Entity Configuration

import type {
  EntityConfig,
  EntityFormConfig,
  SectionConfig,
} from "@/lib/database/types";
import type { Role } from "@/lib/auth-helpers";
import { bffJson } from "~/lib/bff-fetch";
import type {
  CreateRoleRequest,
  UpdateRoleRequest,
} from "~/lib/contract/auth-roles.generated";
import { mapRoleResponse, BASE_ROLE_LABELS } from "@/lib/auth-helpers";
import { ROLE_TEMPLATES, baseRoleOptions } from "@/lib/role-labels";
import { rolesConcept } from "~/lib/concepts/roles";

const nameField = {
  name: "name",
  label: "Name",
  type: "text",
  required: true,
  placeholder: "z. B. OGS-Leitung, Springkraft",
} as const;

const descriptionField = {
  name: "description",
  label: "Beschreibung",
  type: "textarea",
  required: false,
  placeholder: "Wofür ist diese Rolle da?",
} as const;

/**
 * Stammdaten einer bestehenden Rolle (#4574). „Gilt als" ist base_role: es
 * steuert Mitteilungen und Einladungen, nicht die Rechte. Die Vorlage gibt
 * es nur beim Anlegen. „Eltern" steht nicht zur Wahl: eine solche Rolle
 * ließe sich keinem Konto geben.
 */
export const roleEditSections: SectionConfig[] = [
  {
    title: "Rolleninformationen",
    concept: rolesConcept,
    columns: 1,
    fields: [
      nameField,
      descriptionField,
      {
        name: "baseRole",
        label: "Gilt als",
        type: "select",
        required: true,
        placeholder: "Bitte wählen",
        helperText:
          "Bestimmt, welche Mitteilungen die Rolle bekommt. Ändert keine Rechte.",
        options: baseRoleOptions(BASE_ROLE_LABELS),
      },
    ],
  },
];

type RoleForm = Partial<Role> & { template?: string };

/** A new role starts from its template, which also sets base_role (#4574). */
export function toCreateRoleRequest(data: RoleForm): CreateRoleRequest {
  return {
    name: data.name,
    description: data.description,
    ...(data.template
      ? { template: data.template }
      : { base_role: data.baseRole }),
  };
}

/**
 * A system role keeps its base_role. The edit carries the version of the
 * role it was made from (ADR 0311); a role changed since is refused.
 */
export function toUpdateRoleRequest(
  data: Partial<Role>,
  current?: Pick<Role, "version">,
): UpdateRoleRequest {
  return {
    name: data.name,
    description: data.description,
    ...(!data.isSystem && { base_role: data.baseRole }),
    expected_version: current?.version,
  };
}

export const rolesConfig = {
  name: {
    singular: "Rolle",
    plural: "Rollen",
  },

  api: {
    list: async () =>
      (await bffJson("tenant", "GET /auth/roles/")).map(mapRoleResponse),
    get: async (id) =>
      mapRoleResponse(
        await bffJson("tenant", "GET /auth/roles/{id}/", { params: { id } }),
      ),
    create: async (data) =>
      mapRoleResponse(
        await bffJson("tenant", "POST /auth/roles/", {
          body: toCreateRoleRequest(data),
        }),
      ),
    // Answers the stored role with its new version: the next edit sends it
    // without a read. It carries no permissions.
    update: async (id, data, current) =>
      mapRoleResponse(
        await bffJson("tenant", "PUT /auth/roles/{id}/master-data/", {
          params: { id },
          body: toUpdateRoleRequest(data, current),
        }),
      ),
    delete: (id) =>
      bffJson("tenant", "DELETE /auth/roles/{id}/", { params: { id } }),
  },

  form: {
    // Anlegen (#4574): die neue Rolle startet mit den Rechten der Vorlage.
    sections: [
      {
        title: "Rolleninformationen",
        concept: rolesConcept,
        columns: 1,
        fields: [
          nameField,
          descriptionField,
          {
            name: "template",
            label: "Vorlage",
            type: "select",
            required: true,
            placeholder: "Vorlage wählen",
            helperText:
              "Die neue Rolle startet mit den Rechten der Vorlage. Danach kannst du die Rechte frei ändern.",
            options: ROLE_TEMPLATES.map(({ value, label }) => ({
              value,
              label,
            })),
          },
        ],
      },
    ],
  },

  createTitle: "Neue Rolle",
} satisfies EntityConfig<Role> & EntityFormConfig<Role>;
