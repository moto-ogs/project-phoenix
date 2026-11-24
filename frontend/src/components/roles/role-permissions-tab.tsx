"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PermissionGroupsView,
  PermissionPicker,
} from "~/components/roles/permission-picker";
import { EditActions } from "~/components/ui/edit-actions";
import {
  FormErrorAlert,
  LoadErrorAlert,
} from "~/components/ui/form-error-alert";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { isChangedSinceRead } from "~/lib/api-error";
import { authService } from "~/lib/auth-service";
import type { Permission, Role } from "~/lib/auth-helpers";
import { useRefreshAfterWrite } from "~/lib/hooks/use-refresh-after-write";
import { useSwrResourceLoadError } from "~/lib/hooks/use-swr-load-error";
import { createLogger } from "~/lib/logger";
import { useSWRAuth } from "~/lib/swr";
import { staffAccessKeys } from "~/lib/swr/staff-keys";
import {
  isReservedPermission,
  riskyPermissionHint,
} from "~/lib/permission-labels";
import { Loading } from "~/components/ui/loading";

const logger = createLogger({ component: "RolePermissionsTab" });

interface RolePermissionsTabProps {
  readonly role: Role;
  /** Der Reiter steht im Bearbeiten-Zustand (Kopf-Aktion „Bearbeiten"). */
  readonly editing: boolean;
  /** Nach erfolgreichem Speichern; der Aufrufer beendet den Bearbeiten-Zustand. */
  readonly onSaved: () => void | Promise<void>;
  readonly onCancelEdit: () => void;
}

type AssignedMap = Record<string, boolean>;

/**
 * Die Auswahl im Bearbeiten und die Version des Stands, auf dem sie beruht:
 * Speichern schickt diese Version mit, auch wenn der Reiter inzwischen einen
 * neueren Stand zeigt (ADR 0311).
 */
interface Draft {
  readonly map: AssignedMap;
  readonly version: string;
}

const NO_PERMISSIONS: readonly Permission[] = [];

function isReserved(permission: Permission): boolean {
  return isReservedPermission(permission.resource, permission.action);
}

/**
 * Der Warnhinweis unter einem Recht im Bearbeiten-Zustand (#4574): ein
 * gesperrtes Recht, das die Rolle noch aus der Zeit vor der Sperre trägt, oder
 * ein Recht, mit dem jemand Rollen, Konten oder Einstellungen ändern kann.
 */
function permissionHint(permission: Permission): string | undefined {
  if (isReserved(permission)) {
    const owner =
      permission.resource === "admin"
        ? "die Rolle Verwaltung"
        : "das moto-Team";
    return `Nur für ${owner}. Du kannst es entfernen, aber nicht wieder vergeben.`;
  }
  return riskyPermissionHint(permission.resource, permission.action);
}

/**
 * Der Reiter „Berechtigungen" einer Rolle (#3116): welche Berechtigungen
 * die Rolle trägt, nach Bereich gruppiert. Bearbeitet wird am Objekt
 * (BAUARTEN-SPEC Bauart 2 Regeln 3 und 4): die Kopf-Aktion „Bearbeiten"
 * schaltet den Reiter um, die Kästchen ändern nur den Entwurf, EIN
 * „Speichern" unten schreibt die Unterschiede. Vorher war das ein Slide-over
 * neben dem Objekt mit eigenem Speichern.
 */
export function RolePermissionsTab({
  role,
  editing,
  onSaved,
  onCancelEdit,
}: RolePermissionsTabProps) {
  const { success: toastSuccess } = useToast();
  const wasEditing = useRef(editing);
  // Der Reiter zeigt den Stand aus dem gemeinsamen Cache. Speichern schickt
  // dessen Version mit; hat jemand die Rechte inzwischen geändert, lehnt das
  // Backend ab (general.changed_since_read) und der Reiter zeigt den
  // gespeicherten Stand wieder.
  const assignedRead = useSWRAuth(
    staffAccessKeys.rolePermissions(role.id),
    () => authService.getRolePermissions(role.id),
    {
      keepPreviousData: false,
      // Eine bestätigte Liste ersetzt einen älteren Hinweis zum Nachladen.
      onSuccess: () => clearReloadError.current(),
    },
  );
  const catalogRead = useSWRAuth(
    editing ? staffAccessKeys.permissionCatalog() : null,
    () => authService.getPermissions(),
  );
  const assigned = assignedRead.data?.permissions;
  const storedVersion = assignedRead.data?.version ?? "";
  const mutateAssigned = assignedRead.mutate;
  const mutateCatalog = catalogRead.mutate;
  const allPermissions = useMemo(
    () => (editing ? catalogRead.data : assigned) ?? NO_PERMISSIONS,
    [editing, catalogRead.data, assigned],
  );
  const assignedMap = useMemo(() => {
    const map: AssignedMap = {};
    for (const permission of assigned ?? NO_PERMISSIONS)
      map[permission.id] = true;
    return map;
  }, [assigned]);
  // Ladefehler vor Ort, Speicherfehler im Formular, beide mit Wiederholen
  // (#2517). Bis der Katalogtext eines Ladefehlers da ist, bleibt der
  // Ladezustand.
  const { error: loadError, failure } = useSwrResourceLoadError(
    [
      { data: assigned, error: assignedRead.error },
      ...(editing
        ? [{ data: catalogRead.data, error: catalogRead.error }]
        : []),
    ],
    "die Liste der Berechtigungen",
    () => Promise.all([mutateAssigned(), editing ? mutateCatalog() : null]),
  );
  const loadFailed = failure !== undefined;
  const loading =
    !loadFailed && (!assigned || (editing && catalogRead.data === undefined));
  // Der Entwurf: null heißt unverändert, also der gespeicherte Stand. Ein
  // Klick setzt ihn auf Grundlage des gerade gezeigten Stands (#3346) und
  // merkt sich dessen Version.
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftMap = draft?.map ?? assignedMap;
  const [completingSave, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const saving = completingSave || reloading;
  const formRef = useRef<HTMLFormElement>(null);
  const {
    error: saveError,
    show: showSaveError,
    clear: clearSaveError,
  } = useApiFormError(formRef);
  const latestSaveRef = useRef<() => void>(() => undefined);
  const clearReloadError = useRef<() => void>(() => undefined);

  // Nachladen nach dem Speichern: ein Fehler dabei ist ein Ladefehler, kein
  // Fehler des Speicherns (#6652). Der Abruf läuft direkt, damit sein Fehler
  // hier ankommt; die Antwort ersetzt den Eintrag im Cache.
  const afterSave = useRefreshAfterWrite(
    "die Anzeige der Berechtigungen",
    async () => {
      setReloading(true);
      try {
        const [fresh, catalog] = await Promise.all([
          authService.getRolePermissions(role.id),
          authService.getPermissions(),
        ]);
        await Promise.all([
          mutateAssigned(fresh, { revalidate: false }),
          mutateCatalog(catalog, { revalidate: false }),
        ]);
      } finally {
        setReloading(false);
      }
    },
  );

  useLayoutEffect(() => {
    clearReloadError.current = afterSave.clear;
  });

  // Beim Umschalten zwischen Ansicht und Bearbeiten beginnt der Entwurf beim
  // gezeigten Stand; ein Abbruch wirft die Kästchen zurück.
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    setDraft(null);
    if (!editing) return;
    clearSaveError();
  }, [editing, clearSaveError]);

  const assignedCount = useMemo(
    () => allPermissions.filter((p) => assignedMap[p.id] === true).length,
    [allPermissions, assignedMap],
  );

  // Gesperrte Rechte bekommt eine Rolle der Schule nicht (#4574). Trägt sie
  // eins schon, bleibt es sichtbar, damit es entfernt werden kann.
  const selectablePermissions = useMemo(
    () =>
      allPermissions.filter(
        (p) => !isReserved(p) || assignedMap[p.id] === true,
      ),
    [allPermissions, assignedMap],
  );

  const assignedPermissions = useMemo(
    () => allPermissions.filter((p) => assignedMap[p.id] === true),
    [allPermissions, assignedMap],
  );

  const hasChanges = useMemo(
    () =>
      allPermissions.some(
        (p) => (assignedMap[p.id] ?? false) !== (draftMap[p.id] ?? false),
      ),
    [allPermissions, assignedMap, draftMap],
  );
  const toggleOne = (permissionId: string) => {
    setDraft((previous) => {
      const current = previous ?? { map: assignedMap, version: storedVersion };
      return {
        ...current,
        map: { ...current.map, [permissionId]: !current.map[permissionId] },
      };
    });
  };

  const toggleMany = (permissions: readonly Permission[]) => {
    setDraft((previous) => {
      const current = previous ?? { map: assignedMap, version: storedVersion };
      const allChecked = permissions.every((p) => current.map[p.id] === true);
      const next = { ...current.map };
      for (const p of permissions) next[p.id] = !allChecked;
      return { ...current, map: next };
    });
  };

  const handleSave = async () => {
    const permissionIds = allPermissions
      .filter((permission) => draftMap[permission.id] === true)
      .map((permission) => permission.id);
    setSaving(true);
    clearSaveError();
    let storedSelectionVersion: string;
    try {
      storedSelectionVersion = await authService.replaceRolePermissions(
        role.id,
        permissionIds,
        draft?.version ?? storedVersion,
      );
      toastSuccess("Die Berechtigungen der Rolle sind gespeichert.");
    } catch (error) {
      logger.error("role_permissions_save_failed", {
        role_id: role.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // Jemand hat die Rechte seit dem Lesen geändert: Der Reiter zeigt den
      // gespeicherten Stand, ein erneutes Senden würde wieder abgelehnt.
      const changed = isChangedSinceRead(error);
      void showSaveError(
        error,
        changed
          ? { object: "das Speichern der Berechtigungen" }
          : {
              object: "das Speichern der Berechtigungen",
              retry: () => latestSaveRef.current(),
            },
      );
      if (changed) {
        setDraft(null);
        void mutateAssigned();
      }
      setSaving(false);
      return;
    }
    // The write confirms this selection and answers its version, so the
    // next save holds a real token even if the following reads fail.
    setDraft(null);
    await mutateAssigned(
      {
        permissions: allPermissions.filter(
          (permission) => draftMap[permission.id] === true,
        ),
        version: storedSelectionVersion,
      },
      { revalidate: false },
    );
    try {
      await afterSave.refresh();
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  // Wiederholen speichert den aktuellen Entwurf.
  useLayoutEffect(() => {
    latestSaveRef.current = () => void handleSave();
  });

  if (loading || (loadFailed && !loadError)) {
    return <Loading message="Berechtigungen werden geladen..." />;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <LoadErrorAlert error={loadError} />
        {editing ? <EditActions onCancel={onCancelEdit} disabled /> : null}
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-4">
        <LoadErrorAlert error={afterSave.error} />
        <p className="text-sm text-gray-600">
          {editing
            ? `${assignedCount} von ${allPermissions.length} Berechtigungen zugewiesen.`
            : `${assignedCount} ${assignedCount === 1 ? "Berechtigung" : "Berechtigungen"} zugewiesen.`}
        </p>
        {assignedPermissions.length === 0 ? (
          <p className="text-sm text-gray-500">
            {role.isSystem || role.fromTraeger
              ? "Diese Rolle trägt keine Berechtigungen."
              : "Noch keine Berechtigungen zugewiesen. Mit „Bearbeiten“ oben rechts wählst du aus, was diese Rolle darf."}
          </p>
        ) : (
          <PermissionGroupsView permissions={assignedPermissions} />
        )}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      className="space-y-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <LoadErrorAlert error={afterSave.error} />
      <FormErrorAlert message={saveError} />

      <PermissionPicker
        permissions={selectablePermissions}
        selected={draftMap}
        onToggleOne={toggleOne}
        onToggleMany={toggleMany}
        disabled={saving}
        idPrefix="role-permission"
        hint={permissionHint}
      />

      <EditActions
        onCancel={onCancelEdit}
        saving={saving}
        disabled={!hasChanges}
      />
    </form>
  );
}
