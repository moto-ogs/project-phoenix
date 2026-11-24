"use client";

// Die Karte einer Träger-Rolle (#4810): was die Rolle darf und wie jede
// Schule sie führt. Bearbeitet wird in der Karte (BAUARTEN-SPEC Bauart 2):
// Name, „Gilt als“ und Rechte in einem Entwurf, ein „Speichern“ schreibt
// alles und trägt es in alle Schulen.

import {
  CaretDownIcon,
  CaretUpIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import {
  PermissionGroupsView,
  PermissionPicker,
  groupPermissionsByResource,
} from "~/components/roles/permission-picker";
import {
  SchoolRoleFields,
  holderCountLabel,
  schoolRoleBaseLabel,
  schoolRoleDraftErrors,
  type SchoolRoleMasterDraft,
} from "~/components/traeger/school-roles/school-role-fields";
import { Button } from "~/components/ui/button";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import { SectionCard } from "~/components/ui/section-card";
import { SectionLabel } from "~/components/ui/section-label";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError } from "~/contexts/ToastContext";
import { rolesConcept } from "~/lib/concepts/roles";
import { useReadDraftForm } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { localizeResource, riskyPermissionHint } from "~/lib/permission-labels";
import { useDraftOn } from "~/lib/swr/read-draft";
import {
  updateTraegerSchoolRole,
  type TraegerSchoolRole,
  type TraegerSchoolRolePermission,
  type TraegerSchoolRoleSchool,
} from "~/lib/traeger-school-roles-api";

const logger = createLogger({ component: "TraegerSchoolRoleCard" });

interface RoleDraft {
  readonly master: SchoolRoleMasterDraft;
  readonly selected: Readonly<Record<string, boolean>>;
}

function draftOf(role: TraegerSchoolRole): RoleDraft {
  const selected: Record<string, boolean> = {};
  for (const id of role.permissionIds) selected[id] = true;
  return {
    master: {
      name: role.name,
      description: role.description,
      baseRole: role.baseRole,
    },
    selected,
  };
}

function selectedIds(draft: RoleDraft): string[] {
  return Object.keys(draft.selected).filter((id) => draft.selected[id]);
}

function permissionHint(
  permission: TraegerSchoolRolePermission,
): string | undefined {
  return riskyPermissionHint(permission.resource, permission.action);
}

/** So viele Bereiche zeigt die Karte, bevor „Alle Rechte anzeigen“ hilft. */
const AREA_PREVIEW = 4;

/**
 * Was die Rolle darf: je Bereich, wie viele seiner Rechte sie hat. Die ganze
 * Liste klappt darunter auf.
 */
function RolePermissionsSummary({
  role,
  permissions,
}: Readonly<{
  role: TraegerSchoolRole;
  permissions: readonly TraegerSchoolRolePermission[];
}>) {
  const [expanded, setExpanded] = useState(false);
  const held = useMemo(() => {
    const ids = new Set(role.permissionIds);
    return permissions.filter((permission) => ids.has(permission.id));
  }, [role.permissionIds, permissions]);
  const areas = useMemo(() => {
    const total = new Map(
      groupPermissionsByResource(permissions).map(([resource, entries]) => [
        resource,
        entries.length,
      ]),
    );
    return groupPermissionsByResource(held).map(([resource, entries]) => ({
      resource,
      label: localizeResource(resource),
      held: entries.length,
      total: total.get(resource) ?? entries.length,
    }));
  }, [held, permissions]);
  const listId = `traeger-school-role-${role.id}-permissions`;
  const hidden = areas.length - AREA_PREVIEW;
  return (
    <div className="min-w-0">
      <SectionLabel as="h3" className="mb-2">
        Rechte
        <span className="ml-2 font-normal text-gray-500">
          {held.length} in {areas.length}{" "}
          {areas.length === 1 ? "Bereich" : "Bereichen"}
        </span>
      </SectionLabel>
      {held.length === 0 ? (
        <p className="text-sm text-gray-600">
          Diese Rolle darf noch nichts. Wähle „Bearbeiten“ und kreuze an, was
          sie darf.
        </p>
      ) : expanded ? (
        <div id={listId}>
          <PermissionGroupsView permissions={held} />
        </div>
      ) : (
        <FramedList>
          {areas.slice(0, AREA_PREVIEW).map((area) => (
            <li
              key={area.resource}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0 truncate text-sm font-medium text-gray-900">
                {area.label}
              </span>
              <span className="shrink-0 text-sm text-gray-600 tabular-nums">
                {area.held} von {area.total}
              </span>
            </li>
          ))}
        </FramedList>
      )}
      {held.length > 0 ? (
        <Button
          type="button"
          variant="link"
          size="md"
          className="mt-3 gap-1"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          noTooltip="Der Knopf sagt, was er tut, und ändert nichts."
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded
            ? "Weniger anzeigen"
            : hidden > 0
              ? `Alle Rechte anzeigen (${hidden} weitere ${hidden === 1 ? "Bereich" : "Bereiche"})`
              : "Alle Rechte anzeigen"}
          {expanded ? (
            <CaretUpIcon className="size-4" aria-hidden="true" />
          ) : (
            <CaretDownIcon className="size-4" aria-hidden="true" />
          )}
        </Button>
      ) : null}
    </div>
  );
}

function SchoolRow({ school }: Readonly<{ school: TraegerSchoolRoleSchool }>) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="min-w-0 truncate text-sm font-medium text-gray-900">
        {school.schoolName}
      </span>
      {school.carried ? (
        <span className="shrink-0 text-sm text-gray-600">
          {school.holders === 0
            ? "Noch niemand"
            : holderCountLabel(school.holders)}
        </span>
      ) : (
        <StatusBadge
          label={school.nameTaken ? "Name vergeben" : "Nicht übertragen"}
          tone="warning"
        />
      )}
    </li>
  );
}

/** Wie jede Schule die Rolle führt, mit einem Hinweis für die Lücken. */
function RoleSchools({ role }: Readonly<{ role: TraegerSchoolRole }>) {
  const carried = role.schools.filter((school) => school.carried).length;
  const nameTaken = role.schools.some(
    (school) => !school.carried && school.nameTaken,
  );
  const failed = role.schools.some(
    (school) => !school.carried && !school.nameTaken,
  );
  return (
    <div className="min-w-0">
      <SectionLabel as="h3" className="mb-2">
        An den Schulen
        <span className="ml-2 font-normal text-gray-500">
          {carried} von {role.schools.length}
        </span>
      </SectionLabel>
      {role.schools.length === 0 ? (
        <p className="text-sm text-gray-600">
          Dein Träger hat noch keine Schule. Jede neue Schule bekommt die Rolle
          von selbst.
        </p>
      ) : (
        <FramedList maxHeight="md">
          {role.schools.map((school) => (
            <SchoolRow key={school.schoolId} school={school} />
          ))}
        </FramedList>
      )}
      {nameTaken ? (
        <p className="mt-2 text-sm text-gray-600">
          „Name vergeben“: Die Schule hat schon eine eigene Rolle mit diesem
          Namen. Gib deiner Rolle einen anderen Namen, oder die Schule benennt
          ihre um.
        </p>
      ) : null}
      {failed ? (
        <p className="mt-2 text-sm text-gray-600">
          „Nicht übertragen“: Wähle „Bearbeiten“ und „Speichern“. Dann trägt
          moto die Rolle auch in diese Schulen.
        </p>
      ) : null}
    </div>
  );
}

export function SchoolRoleCard({
  role,
  permissions,
  reload,
  onSaved,
  onRemove,
}: Readonly<{
  role: TraegerSchoolRole;
  /** Der Katalog: jedes Recht, das eine Rolle der Schule tragen darf. */
  permissions: readonly TraegerSchoolRolePermission[];
  /** Liest die Rollen neu; lehnt ab, wenn das Lesen scheitert (ADR 0311). */
  reload: () => Promise<readonly TraegerSchoolRole[]>;
  onSaved: (role: TraegerSchoolRole, message: string) => void;
  onRemove: () => void;
}>) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const storedRole = async () => {
    const found = (await reload()).find((entry) => entry.id === role.id);
    if (!found) throw new Error("role is gone");
    return found;
  };
  // Das Formular ruht auf der Rolle, wie sie beim Öffnen war (ADR 0311): Ein
  // neuerer Stand füllt es nur, solange nichts geändert ist. Nach einer
  // Ablehnung zeigt es die gespeicherte Rolle mit der Meldung.
  const edit = useDraftOn<
    TraegerSchoolRole,
    RoleDraft,
    string,
    TraegerSchoolRole
  >(
    {
      opening: editing ? `traeger-school-role:${role.id}` : null,
      data: role,
      reload: storedRole,
      write: async (stored) => onSaved(stored, ""),
    },
    {
      token: (read) => read.version,
      toDraft: draftOf,
      answer: (saved) => saved,
    },
  );
  const form = useReadDraftForm(editing ? edit : null, errors, "die Rolle");
  const draft = editing ? edit.draft : undefined;

  const save = async () => {
    if (!draft || !form.begin()) return;
    const invalid = schoolRoleDraftErrors(draft.master);
    if (Object.keys(invalid).length > 0) {
      errors.invalid("Bitte prüfe die markierten Felder.", invalid);
      return;
    }
    setSaving(true);
    const result = await edit.submit((version, sent) =>
      updateTraegerSchoolRole(
        role.id,
        { ...sent.master, permissionIds: selectedIds(sent) },
        version,
      ),
    );
    setSaving(false);
    if (result.ok) {
      setEditing(false);
      onSaved(
        result.saved,
        `Die Rolle „${result.saved.name}“ ist gespeichert. Alle Schulen sehen die Änderung.`,
      );
      return;
    }
    if (result.skipped) return;
    logger.error("traeger_school_role_update_failed", {
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    // Seit dem Öffnen geändert: Das Formular bleibt offen und zeigt die
    // gespeicherte Rolle, ohne Wiederholen (ADR 0311).
    void errors.show(result.error, {
      object: "die Rolle",
      reload: result.reload,
    });
  };

  const toggleMany = (entries: readonly TraegerSchoolRolePermission[]) => {
    if (!draft) return;
    const allChecked = entries.every((entry) => draft.selected[entry.id]);
    const selected = { ...draft.selected };
    for (const entry of entries) selected[entry.id] = !allChecked;
    edit.setDraft({ ...draft, selected });
  };

  return (
    <SectionCard
      concept={rolesConcept}
      title={role.name}
      titleBadge={
        <StatusBadge
          label={`Gilt als ${schoolRoleBaseLabel(role.baseRole)}`}
          tone="gray"
        />
      }
      description={role.description || undefined}
      action={
        editing ? undefined : (
          <div className="flex items-center gap-2">
            <Button
              size="md"
              type="button"
              variant="outline"
              className="gap-2"
              tooltip="Öffnet Name und Rechte dieser Rolle zum Bearbeiten."
              onClick={() => {
                errors.clear();
                setEditing(true);
              }}
            >
              <PencilSimpleIcon className="h-4 w-4" aria-hidden="true" />
              Bearbeiten
            </Button>
            <OverflowMenu
              ariaLabel={`Weitere Aktionen zu ${role.name}`}
              items={[
                {
                  label: "Entfernen",
                  description:
                    "Nimmt die Rolle aus allen Schulen. moto zeigt vorher, wer sie verliert.",
                  icon: <TrashIcon className="size-4" aria-hidden="true" />,
                  destructive: true,
                  onClick: onRemove,
                },
              ]}
            />
          </div>
        )
      }
      footer={
        editing ? (
          <EditActions
            onCancel={() => setEditing(false)}
            onSave={() => void save()}
            saving={saving}
            disabled={!edit.canSubmit}
            disabledReason={form.waitReason}
            saveTooltip="Speichert die Rolle und trägt die Änderung sofort in alle deine Schulen."
          />
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-4">
          <LoadErrorAlert error={form.loadError} />
          <FormErrorAlert message={errors.error} />
          {draft ? (
            <>
              <SchoolRoleFields
                idPrefix={`traeger-school-role-${role.id}`}
                draft={draft.master}
                disabled={saving}
                onChange={(master) => edit.setDraft({ ...draft, master })}
                fieldError={errors.fieldError}
              />
              <SectionLabel as="h3">Rechte</SectionLabel>
              <p className="text-sm text-gray-600">
                Ein neues Recht haben die Personen kurz nach dem Speichern.
                Nimmst du ein Recht weg, meldet moto sie ab. Sie melden sich
                danach wieder an.
              </p>
              <PermissionPicker
                permissions={permissions}
                selected={draft.selected}
                disabled={saving}
                idPrefix={`traeger-school-role-${role.id}-permission`}
                hint={permissionHint}
                startCollapsed
                onToggleOne={(id) =>
                  edit.setDraft({
                    ...draft,
                    selected: { ...draft.selected, [id]: !draft.selected[id] },
                  })
                }
                onToggleMany={toggleMany}
              />
            </>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <RolePermissionsSummary role={role} permissions={permissions} />
          <RoleSchools role={role} />
        </div>
      )}
    </SectionCard>
  );
}
