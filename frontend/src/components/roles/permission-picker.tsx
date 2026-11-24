"use client";

import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { EmptyState } from "~/components/ui/empty-state";
import { Input } from "~/components/ui/input";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { SectionCard } from "~/components/ui/section-card";
import {
  formatPermissionDisplay,
  localizeAction,
  localizeDescription,
  localizeResource,
} from "~/lib/permission-labels";

/**
 * Ein Recht, wie die Auswahl es zeigt. Die Rolle einer Schule und die Rolle
 * eines Trägers (#4810) wählen aus demselben Katalog.
 */
export interface PermissionOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly resource: string;
  readonly action: string;
}

/** Die Rechte nach Bereich, die Bereiche nach ihrem deutschen Namen. */
export function groupPermissionsByResource<P extends PermissionOption>(
  permissions: readonly P[],
): Array<[string, P[]]> {
  const groups: Record<string, P[]> = {};
  for (const permission of permissions) {
    (groups[permission.resource] ??= []).push(permission);
  }
  return Object.entries(groups).sort(([a], [b]) =>
    localizeResource(a).localeCompare(localizeResource(b), "de"),
  );
}

function permissionLabel(permission: PermissionOption): string {
  return formatPermissionDisplay(permission.resource, permission.action);
}

/** Was eine Rolle darf, nach Bereich: die Ansicht ohne Bearbeiten. */
export function PermissionGroupsView({
  permissions,
}: Readonly<{ permissions: readonly PermissionOption[] }>) {
  const groups = useMemo(
    () => groupPermissionsByResource(permissions),
    [permissions],
  );
  return (
    <SectionCard padding="none">
      {groups.map(([resource, entries]) => (
        <section key={resource} className="px-4 py-3">
          <h4 className="text-sm font-semibold text-gray-900">
            {localizeResource(resource)}
            <span className="ml-2 text-xs font-normal text-gray-500">
              {entries.length}
            </span>
          </h4>
          <ul className="mt-1.5 space-y-1">
            {entries.map((permission) => (
              <li key={permission.id} className="text-sm text-gray-700">
                {permissionLabel(permission)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SectionCard>
  );
}

interface PermissionPickerProps<P extends PermissionOption> {
  /** Die Rechte zur Auswahl. */
  readonly permissions: readonly P[];
  /** Der Entwurf: die ID jedes ausgewählten Rechts. */
  readonly selected: Readonly<Record<string, boolean>>;
  readonly onToggleOne: (permissionId: string) => void;
  /** Wählt alle ab, wenn alle gewählt sind, sonst alle aus. */
  readonly onToggleMany: (permissions: readonly P[]) => void;
  readonly disabled?: boolean;
  /** Präfix der Feld-IDs; je Seite eindeutig. */
  readonly idPrefix: string;
  /** Warnhinweis unter einem Recht, etwa für ein riskantes. */
  readonly hint?: (permission: P) => string | undefined;
  /**
   * Die Bereiche starten zugeklappt, für eine Auswahl mitten auf einer Seite:
   * Die Liste zeigt dann je Bereich eine Zeile mit der Zahl der gewählten
   * Rechte. Eine Suche klappt ihre Treffer auf.
   */
  readonly startCollapsed?: boolean;
}

/**
 * Die Auswahl der Rechte einer Rolle: suchen, alle wählen, je Bereich
 * aufklappen und ankreuzen. Sie ändert nur den Entwurf; gespeichert wird im
 * Formular darum (`EditActions`).
 */
export function PermissionPicker<P extends PermissionOption>({
  permissions,
  selected,
  onToggleOne,
  onToggleMany,
  disabled = false,
  idPrefix,
  hint,
  startCollapsed = false,
}: PermissionPickerProps<P>) {
  const [searchTerm, setSearchTerm] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return permissions;
    return permissions.filter(
      (permission) =>
        permission.name.toLowerCase().includes(query) ||
        permission.description.toLowerCase().includes(query) ||
        permission.resource.toLowerCase().includes(query) ||
        permission.action.toLowerCase().includes(query) ||
        localizeResource(permission.resource).toLowerCase().includes(query) ||
        localizeAction(permission.action, permission.resource)
          .toLowerCase()
          .includes(query),
    );
  }, [permissions, searchTerm]);
  const groups = useMemo(
    () => groupPermissionsByResource(filtered),
    [filtered],
  );
  const selectedCount = useMemo(
    () => permissions.filter((p) => selected[p.id] === true).length,
    [permissions, selected],
  );
  const allFilteredChecked =
    filtered.length > 0 && filtered.every((p) => selected[p.id] === true);

  return (
    <>
      <p className="text-sm text-gray-600">
        {selectedCount} von {permissions.length} Berechtigungen ausgewählt.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            controlSize="compact"
            name={`${idPrefix}s-search`}
            aria-label="Berechtigungen suchen"
            placeholder="Berechtigungen suchen…"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            disabled={disabled}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="md"
          disabled={disabled || filtered.length === 0}
          disabledReason={
            disabled
              ? undefined
              : searchTerm.trim()
                ? "Keine Berechtigung passt zu deiner Suche."
                : "Es gibt keine Berechtigung zum Auswählen."
          }
          onClick={() => onToggleMany(filtered)}
          tooltip={
            allFilteredChecked
              ? "Wählt alle angezeigten Berechtigungen ab, noch ohne zu speichern."
              : "Wählt alle angezeigten Berechtigungen aus, noch ohne zu speichern."
          }
        >
          {allFilteredChecked ? "Alle abwählen" : "Alle auswählen"}
        </Button>
      </div>

      <SectionCard padding="none">
        {groups.length === 0 ? (
          <EmptyState title="Keine Berechtigungen gefunden." className="py-8" />
        ) : (
          groups.map(([resource, entries]) => {
            const groupChecked = entries.filter(
              (p) => selected[p.id] === true,
            ).length;
            const isCollapsed =
              startCollapsed && searchTerm.trim() !== ""
                ? false
                : (collapsed[resource] ?? startCollapsed);
            const groupLabel = localizeResource(resource);
            return (
              <section
                key={resource}
                className="border-b border-gray-100 last:border-b-0"
              >
                <ListGroupHeader
                  title={groupLabel}
                  addon={
                    <span className="text-xs text-gray-500">
                      {groupChecked}/{entries.length}
                    </span>
                  }
                  collapsible={{
                    expanded: !isCollapsed,
                    onToggle: () =>
                      setCollapsed((current) => ({
                        ...current,
                        [resource]: !isCollapsed,
                      })),
                  }}
                  meta={
                    <label
                      htmlFor={`${idPrefix}-group-${resource}`}
                      className="flex cursor-pointer items-center gap-2 text-xs text-gray-600"
                    >
                      <Checkbox
                        id={`${idPrefix}-group-${resource}`}
                        checked={groupChecked === entries.length}
                        disabled={disabled}
                        onChange={() => onToggleMany(entries)}
                        aria-label={`Alle Berechtigungen für ${groupLabel} auswählen`}
                      />
                      Alle
                    </label>
                  }
                />
                {isCollapsed
                  ? null
                  : entries.map((permission) => (
                      <PermissionRow
                        key={permission.id}
                        permission={permission}
                        checked={selected[permission.id] === true}
                        disabled={disabled}
                        idPrefix={idPrefix}
                        hint={hint?.(permission)}
                        onToggle={() => onToggleOne(permission.id)}
                      />
                    ))}
              </section>
            );
          })
        )}
      </SectionCard>
    </>
  );
}

function PermissionRow({
  permission,
  checked,
  disabled,
  idPrefix,
  hint,
  onToggle,
}: Readonly<{
  permission: PermissionOption;
  checked: boolean;
  disabled: boolean;
  idPrefix: string;
  hint: string | undefined;
  onToggle: () => void;
}>) {
  const description = localizeDescription(
    permission.resource,
    permission.action,
    permission.description,
  );
  return (
    <label
      htmlFor={`${idPrefix}-${permission.id}`}
      className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-gray-50"
    >
      <Checkbox
        id={`${idPrefix}-${permission.id}`}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        aria-label={permissionLabel(permission)}
        aria-describedby={
          hint ? `${idPrefix}-hint-${permission.id}` : undefined
        }
        className="mt-0.5"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">
          {permissionLabel(permission)}
        </span>
        <span className="block text-xs text-gray-500">
          {localizeAction(permission.action, permission.resource)}
          {description ? ` · ${description}` : ""}
        </span>
        {hint ? (
          <span
            id={`${idPrefix}-hint-${permission.id}`}
            className="text-moto-amber-strong mt-0.5 block text-xs font-medium"
          >
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
