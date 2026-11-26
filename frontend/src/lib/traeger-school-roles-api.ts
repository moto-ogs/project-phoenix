import type { z } from "zod";
import { bffJson } from "~/lib/bff-fetch";
/**
 * Rollen des Trägers für das Personal aller seiner Schulen (#4810, ADR 0317).
 *
 * Das Träger-Büro legt eine Rolle einmal an: Name, „Gilt als“ und Rechte aus
 * dem Katalog der Schule. moto trägt sie in jede Schule des Trägers, auch in
 * Schulen, die später dazukommen. Die Schule weist sie zu, ändert und löscht
 * sie aber nicht.
 */
import type * as contract from "~/lib/contract/traeger-school-roles.generated";

/** „Gilt als“ einer Träger-Rolle: Betreuung oder Verwaltung. */
export type TraegerSchoolRoleBase = "user" | "admin";

/** Wie eine Schule eine Rolle des Trägers führt. */
export interface TraegerSchoolRoleSchool {
  readonly schoolId: string;
  readonly schoolName: string;
  /** `false`, solange die Rolle an der Schule nicht angekommen ist. */
  readonly carried: boolean;
  /** Der Grund dafür: Die Schule hat eine eigene Rolle mit dem Namen. */
  readonly nameTaken: boolean;
  /** So viele Personen haben die Rolle an der Schule. */
  readonly holders: number;
}

export interface TraegerSchoolRole {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly baseRole: TraegerSchoolRoleBase;
  readonly permissionIds: readonly string[];
  readonly schools: readonly TraegerSchoolRoleSchool[];
  /** Stand der Rolle; Bearbeiten schickt ihn zurück (ADR 0311). */
  readonly version: string;
}

export interface TraegerSchoolRoleList {
  readonly roles: readonly TraegerSchoolRole[];
  readonly schoolCount: number;
}

/** Ein Recht, das eine Rolle der Schule tragen darf. */
export interface TraegerSchoolRolePermission {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly resource: string;
  readonly action: string;
}

export interface TraegerSchoolRoleCatalog {
  readonly permissions: readonly TraegerSchoolRolePermission[];
  /** Die Vorauswahl je „Gilt als“. */
  readonly templates: Readonly<
    Record<TraegerSchoolRoleBase, readonly string[]>
  >;
}

export interface TraegerSchoolRoleInput {
  readonly name: string;
  readonly description: string;
  readonly baseRole: TraegerSchoolRoleBase;
  readonly permissionIds: readonly string[];
}

/** Eine Person, die die Rolle an einer Schule hat. */
interface TraegerSchoolRoleHolder {
  readonly accountId: string;
  /** Leer, wenn zum Konto keine Person an der Schule gehört. */
  readonly name: string;
  readonly email: string;
}

export interface TraegerSchoolRoleRemovalSchool {
  readonly schoolId: string;
  readonly schoolName: string;
  readonly holders: readonly TraegerSchoolRoleHolder[];
  /** Eine Einladung der Schule nennt die Rolle: Sie bleibt dort bestehen. */
  readonly keptForInvitations: boolean;
}

/** Die Vorschau vor dem Entfernen: wer die Rolle an welcher Schule hat. */
export interface TraegerSchoolRoleRemoval {
  readonly schools: readonly TraegerSchoolRoleRemovalSchool[];
  /** Das Entfernen schickt ihn zurück: Es gilt nur für diese Vorschau. */
  readonly version: string;
}

function baseRoleOf(value: string): TraegerSchoolRoleBase {
  return value === "admin" ? "admin" : "user";
}

function mapRole(data: contract.SchoolRoleResponse): TraegerSchoolRole {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    baseRole: baseRoleOf(data.base_role),
    permissionIds: data.permission_ids ?? [],
    schools: (data.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      schoolName: school.school_name,
      carried: school.carried,
      nameTaken: school.name_taken,
      holders: school.holders,
    })),
    version: data.version,
  };
}

function roleBody(input: TraegerSchoolRoleInput) {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    base_role: input.baseRole,
    permission_ids: [...input.permissionIds],
  };
}

export async function fetchTraegerSchoolRoles(): Promise<TraegerSchoolRoleList> {
  return mapTraegerSchoolRoles(
    await bffJson("org", "GET /traeger/school-roles/"),
  );
}

export function mapTraegerSchoolRoles(
  data: z.output<
    (typeof contract.routes)["GET /traeger/school-roles/"]["response"]
  >["data"],
): TraegerSchoolRoleList {
  return {
    roles: (data.roles ?? []).map(mapRole),
    schoolCount: (data.schools ?? []).length,
  };
}

export async function fetchTraegerSchoolRoleCatalog(): Promise<TraegerSchoolRoleCatalog> {
  return mapTraegerSchoolRoleCatalog(
    await bffJson("org", "GET /traeger/school-roles/catalog"),
  );
}

export function mapTraegerSchoolRoleCatalog(
  data: z.output<
    (typeof contract.routes)["GET /traeger/school-roles/catalog"]["response"]
  >["data"],
): TraegerSchoolRoleCatalog {
  const templates: Record<TraegerSchoolRoleBase, readonly string[]> = {
    user: [],
    admin: [],
  };
  for (const template of data.templates ?? []) {
    templates[baseRoleOf(template.base_role)] = template.permission_ids ?? [];
  }
  return { permissions: data.permissions ?? [], templates };
}

export async function createTraegerSchoolRole(
  input: TraegerSchoolRoleInput,
): Promise<TraegerSchoolRole> {
  return mapRole(
    await bffJson("org", "POST /traeger/school-roles/", {
      body: roleBody(input),
    }),
  );
}

/** Schreibt die Rolle neu, auf dem Stand `expectedVersion` (ADR 0311). */
export async function updateTraegerSchoolRole(
  id: string,
  input: TraegerSchoolRoleInput,
  expectedVersion: string,
): Promise<TraegerSchoolRole> {
  return mapRole(
    await bffJson("org", "PUT /traeger/school-roles/{id}", {
      params: { id },
      body: { ...roleBody(input), expected_version: expectedVersion },
    }),
  );
}

export async function fetchTraegerSchoolRoleRemoval(
  id: string,
): Promise<TraegerSchoolRoleRemoval> {
  const data = await bffJson(
    "org",
    "GET /traeger/school-roles/{id}/removal-preview",
    { params: { id } },
  );
  return {
    schools: (data.schools ?? []).map((school) => ({
      schoolId: school.school_id,
      schoolName: school.school_name,
      keptForInvitations: school.kept_for_invitations,
      holders: (school.holders ?? []).map((holder) => ({
        accountId: holder.account_id,
        name: holder.name,
        email: holder.email,
      })),
    })),
    version: data.version,
  };
}

/** Entfernt die Rolle überall, nur für die bestätigte Vorschau (ADR 0311). */
export async function removeTraegerSchoolRole(
  id: string,
  expectedVersion: string,
): Promise<void> {
  await bffJson("org", "POST /traeger/school-roles/{id}/removal", {
    params: { id },
    body: { expected_version: expectedVersion },
  });
}
