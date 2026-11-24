"use client";

// Rollen des Trägers für das Personal aller seiner Schulen (#4810, ADR 0317).
// Das Träger-Büro legt eine Rolle einmal an. moto trägt sie in jede Schule,
// auch in Schulen, die später dazukommen. Die Schule weist sie zu, ändert und
// löscht sie aber nicht. Die Karte jeder Rolle zeigt deshalb, was sie darf
// und wie viele Personen sie an jeder Schule haben.

import { PlusIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import { SchoolRoleCard } from "~/components/traeger/school-roles/school-role-card";
import {
  CreateSchoolRoleModal,
  RemoveSchoolRoleModal,
} from "~/components/traeger/school-roles/school-role-modals";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { Button } from "~/components/ui/button";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useToast } from "~/contexts/ToastContext";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  fetchTraegerSchoolRoleCatalog,
  fetchTraegerSchoolRoles,
  type TraegerSchoolRole,
  type TraegerSchoolRoleCatalog,
  type TraegerSchoolRoleList,
} from "~/lib/traeger-school-roles-api";

interface SchoolRolesPageData {
  readonly list: TraegerSchoolRoleList;
  readonly catalog: TraegerSchoolRoleCatalog;
}

/** Rollen und Rechtekatalog in einem Lesen: Die Karten brauchen beides. */
async function fetchSchoolRolesPage(): Promise<SchoolRolesPageData> {
  const [list, catalog] = await Promise.all([
    fetchTraegerSchoolRoles(),
    fetchTraegerSchoolRoleCatalog(),
  ]);
  return { list, catalog };
}

const INFO = (
  <div className="space-y-2">
    <p>
      Hier legst du Rollen für das Personal deiner Schulen an, etwa
      Springerkraft. moto trägt jede Rolle in alle deine Schulen, auch in
      Schulen, die später dazukommen.
    </p>
    <p>
      Die Schule gibt die Rolle ihren Personen. Ändern und löschen kannst nur
      du. Eigene Rollen legt jede Schule weiter selbst an.
    </p>
    <p>Wer im Träger-Büro was darf, steht unter „Mitglieder und Rollen“.</p>
  </div>
);

export default function TraegerSchoolRolesPage() {
  const { data, loading, error, mutate, reload, reloadOrThrow } =
    useTraegerResource(
      traegerKeys.schoolRoles(),
      fetchSchoolRolesPage,
      "die Rollen für deine Schulen",
    );
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<TraegerSchoolRole | null>(null);
  const { success } = useToast();
  const list = data?.list;

  const replace = useCallback(
    (saved: TraegerSchoolRole) => {
      void mutate(
        (current) => {
          if (!current) return current;
          const known = current.list.roles.some((role) => role.id === saved.id);
          const roles = known
            ? current.list.roles.map((role) =>
                role.id === saved.id ? saved : role,
              )
            : [...current.list.roles, saved];
          return {
            ...current,
            list: {
              ...current.list,
              roles: [...roles].sort((a, b) =>
                a.name.localeCompare(b.name, "de"),
              ),
            },
          };
        },
        { revalidate: false },
      );
    },
    [mutate],
  );

  const remove = useCallback(
    (removed: TraegerSchoolRole) => {
      void mutate(
        (current) =>
          current
            ? {
                ...current,
                list: {
                  ...current.list,
                  roles: current.list.roles.filter(
                    (role) => role.id !== removed.id,
                  ),
                },
              }
            : current,
        { revalidate: false },
      );
    },
    [mutate],
  );

  const holders = useMemo(
    () =>
      list?.roles.reduce(
        (sum, role) =>
          sum + role.schools.reduce((n, school) => n + school.holders, 0),
        0,
      ) ?? 0,
    [list],
  );

  return (
    <TenantPage
      title="Rollen für Schulen"
      info={INFO}
      stats={
        list ? (
          <TenantPageStats
            items={[
              {
                value: list.roles.length,
                label: list.roles.length === 1 ? "Rolle" : "Rollen",
              },
              {
                value: list.schoolCount,
                label: list.schoolCount === 1 ? "Schule" : "Schulen",
              },
              {
                value: holders,
                label:
                  holders === 1
                    ? "Person mit einer dieser Rollen"
                    : "Personen mit einer dieser Rollen",
              },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      error={error}
      loading={loading}
      actions={
        data ? (
          <Button
            type="button"
            size="md"
            variant="primary"
            className="gap-2"
            tooltip="Öffnet ein Formular für eine neue Rolle an allen deinen Schulen."
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            Rolle anlegen
          </Button>
        ) : undefined
      }
      empty={
        list?.roles.length === 0
          ? {
              title: "Noch keine Rolle für deine Schulen.",
              description:
                "Lege oben eine Rolle an, zum Beispiel Springerkraft. Jede deiner Schulen findet sie danach unter „Rollen“ und gibt sie ihren Personen.",
            }
          : undefined
      }
      overlays={
        data ? (
          <>
            <CreateSchoolRoleModal
              isOpen={creating}
              catalog={data.catalog}
              onClose={() => setCreating(false)}
              onCreated={(created) => {
                setCreating(false);
                replace(created);
                success(
                  `Die Rolle „${created.name}“ ist angelegt. Alle Schulen sehen sie.`,
                );
              }}
            />
            <RemoveSchoolRoleModal
              role={removing}
              onClose={() => setRemoving(null)}
              onFailed={() => void reload()}
              onRemoved={(removed) => {
                setRemoving(null);
                remove(removed);
                success(`Die Rolle „${removed.name}“ ist entfernt.`);
              }}
            />
          </>
        ) : undefined
      }
    >
      {/* Gleiche Karten in einem Raster: Raster wachsen nicht (Regel des
          TenantPage-Körpers), so behält die letzte Rolle ihre Höhe. */}
      {data && data.list.roles.length > 0 ? (
        <div className="compact:gap-4 grid gap-6 max-sm:gap-3">
          {data.list.roles.map((role) => (
            <SchoolRoleCard
              key={role.id}
              role={role}
              permissions={data.catalog.permissions}
              reload={async () => (await reloadOrThrow()).list.roles}
              onSaved={(saved, message) => {
                replace(saved);
                if (message) success(message);
              }}
              onRemove={() => setRemoving(role)}
            />
          ))}
        </div>
      ) : null}
    </TenantPage>
  );
}
