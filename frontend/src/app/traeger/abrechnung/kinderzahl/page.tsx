"use client";

// Kinderzahl der Familien (#5918): wie viele Kinder eine Familie hat, auch
// Geschwister ohne Betreuungsvertrag. Eltern geben die Zahl im Vertrag an,
// die Abrechnung bestätigt oder ändert sie mit Gültigkeit. Eine
// Geschwisterregel, die das einschaltet, zählt diese Zahl, mindestens aber
// die Kinder mit Vertrag. Nur das Recht „Abrechnung“ sieht die Seite; jedes
// Lesen steht im Zugriffsprotokoll des Vertrags.

import { useMemo, useState } from "react";
import {
  billingAreaTitle,
  billingTabs,
} from "~/components/traeger/billing-family-format";
import {
  checkReason,
  childrenLabel,
  familyAddress,
  familyKey,
  familyName,
  NEEDS_CHECK,
  STATUS_LABELS,
  STATUS_TONES,
  statedOn,
  validityLabel,
} from "~/components/traeger/family-children-format";
import { FamilyChildrenModal } from "~/components/traeger/family-children-modal";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import {
  ChevronDown,
  ChevronUp,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Alert } from "~/components/ui/alert";
import { Button, ButtonLink } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
  ResponsiveRowActions,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { parentsConcept } from "~/lib/concepts/parents";
import { berlinTodayISO } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import { downloadTraegerList } from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";
import {
  type FamilyChildren,
  fetchFamilyChildren,
  removeFamilyChildren,
} from "~/lib/traeger-family-children-api";

const logger = createLogger({ component: "TraegerKinderzahlPage" });

/** Rows of „Zu prüfen“ shown before „N weitere anzeigen“. */
const INITIAL_CHECKS = 5;

function ContractChildrenCell({
  family,
}: Readonly<{ family: FamilyChildren }>) {
  if (family.children.length === 0) {
    return (
      <span className="text-sm text-gray-600">Noch kein wirksamer Vertrag</span>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-sm text-gray-900">
        {childrenLabel(family.children.length)}
      </p>
      {/* A child with its school stays on one line; the list wraps between
          children. */}
      <p className="mt-0.5 text-sm text-gray-600">
        {family.children.map((child, index) => (
          <span key={child.contractId}>
            {index > 0 ? ", " : null}
            <span className="whitespace-nowrap">
              {`${child.childFirstName} (${child.schoolName})`}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}

function ConfirmedCell({ family }: Readonly<{ family: FamilyChildren }>) {
  const count = family.count;
  if (!count?.confirmedChildren) {
    return <span className="text-sm text-gray-500">– nicht bestätigt</span>;
  }
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold whitespace-nowrap text-gray-900 tabular-nums">
        {childrenLabel(count.confirmedChildren)}
      </p>
      {/* A date stays with its „ab“; a range may break at „bis“. */}
      <p className="mt-0.5 text-sm text-gray-600 tabular-nums">
        {validityLabel(count).replace(/(ab|bis) /g, "$1\u00a0")}
      </p>
    </div>
  );
}

function StatedCell({ family }: Readonly<{ family: FamilyChildren }>) {
  const count = family.count;
  if (!count?.statedChildren) {
    return <span className="text-sm text-gray-500">–</span>;
  }
  return (
    <div className="min-w-0">
      <p className="text-sm text-gray-900 tabular-nums">
        {childrenLabel(count.statedChildren)}
      </p>
      <p className="mt-0.5 text-sm text-gray-600">am {statedOn(count)}</p>
    </div>
  );
}

/**
 * What the Monatslauf counts until the office checks, per kind of entry: an
 * expired number no longer counts, a changed or expiring one still does.
 */
function checkCardText(
  toCheck: readonly FamilyChildren[],
  missing: number,
): string {
  const expired = toCheck.some((family) => family.status === "expired");
  const stillValid = toCheck.some(
    (family) => family.status === "changed" || family.status === "expiring",
  );
  return [
    stillValid
      ? "Bei geänderten oder bald ablaufenden Zahlen zählt der Monatslauf bis zu deiner Prüfung die bisher bestätigte Zahl."
      : null,
    expired
      ? "Eine abgelaufene Kinderzahl gilt nicht mehr. Bis du neu prüfst, zählen nur die Kinder mit Vertrag."
      : null,
    toCheck.some((family) => family.status === "stated")
      ? "Eine neue Angabe der Eltern zählt erst, wenn du sie bestätigst."
      : null,
    toCheck.some((family) => family.status === "differing")
      ? "Bei verschiedenen Angaben zählt keine Zahl, bis du eine bestätigst."
      : null,
    missing > 0
      ? expired
        ? `Das gilt auch für ${missing === 1 ? "die Familie" : `die ${missing} Familien`} ohne Angabe.`
        : `Bei ${missing === 1 ? "der Familie" : `den ${missing} Familien`} ohne Angabe zählen nur die Kinder mit Vertrag.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function TraegerKinderzahlPage() {
  const today = berlinTodayISO();
  const {
    data,
    loading,
    error: loadError,
    mutate,
  } = useTraegerResource(
    traegerBillingKeys.childCounts(),
    fetchFamilyChildren,
    "die Übersicht der Kinderzahlen",
  );
  const [search, setSearch] = useState("");
  const [checking, setChecking] = useState<FamilyChildren | null>(null);
  const [removing, setRemoving] = useState<FamilyChildren | null>(null);
  const [busy, setBusy] = useState(false);
  const [checksExpanded, setChecksExpanded] = useState(false);
  const removeErrors = useApiFormError();
  const { success } = useToast();

  const remove = async () => {
    const contract = removing?.contractId;
    if (!removing || !contract) return;
    setBusy(true);
    removeErrors.clear();
    try {
      await mutate(await removeFamilyChildren(contract), { revalidate: false });
      success(`Die Kinderzahl von ${familyName(removing)} ist entfernt.`);
      setRemoving(null);
    } catch (err) {
      logger.error("family_children_remove_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      void removeErrors.show(err, { object: "die Kinderzahl" });
    } finally {
      setBusy(false);
    }
  };

  const families = data?.families ?? [];
  const toCheck = families.filter((family) =>
    NEEDS_CHECK.includes(family.status),
  );
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.families ?? []).filter((family) =>
      needle
        ? [
            familyName(family),
            familyAddress(family),
            ...family.children.map(
              (child) => `${child.childFirstName} ${child.childLastName}`,
            ),
          ]
            .join(" ")
            .toLowerCase()
            .includes(needle)
        : true,
    );
  }, [data, search]);

  const columns: DataTableColumn<FamilyChildren>[] = [
    {
      key: "family",
      header: "Familie",
      stacked: "title",
      className: "w-64 align-top",
      render: (family) => (
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">{familyName(family)}</p>
          <p className="mt-0.5 truncate text-sm text-gray-600">
            {familyAddress(family)}
          </p>
        </div>
      ),
    },
    {
      key: "contracts",
      header: "Kinder mit Vertrag",
      stacked: "field",
      className: "align-top",
      render: (family) => <ContractChildrenCell family={family} />,
    },
    {
      key: "stated",
      header: "Angabe der Eltern",
      stacked: "field",
      className: "w-40 align-top",
      render: (family) => <StatedCell family={family} />,
    },
    {
      key: "confirmed",
      header: "Bestätigte Kinderzahl",
      stacked: "field",
      className: "w-48 align-top",
      render: (family) => <ConfirmedCell family={family} />,
    },
    {
      key: "status",
      header: "Stand",
      stacked: "field",
      className: "w-44 align-top",
      render: (family) => (
        <StatusBadge
          tone={STATUS_TONES[family.status]}
          label={STATUS_LABELS[family.status]}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      className: "w-12 align-top",
      render: (family) => (
        <OverflowMenu
          ariaLabel={`Kinderzahl: ${familyName(family)}`}
          items={[
            {
              label: family.count?.confirmedChildren
                ? "Kinderzahl ändern"
                : "Kinderzahl bestätigen",
              description:
                "Öffnet ein Fenster, um die Kinderzahl zu bestätigen oder zu ändern",
              onClick: () => setChecking(family),
            },
            ...(family.count || family.status === "differing"
              ? [
                  {
                    label: "Kinderzahl entfernen",
                    icon: <Trash2 className="size-4" aria-hidden />,
                    description:
                      "moto fragt vorher nach, dann zählen neue Läufe nur Kinder mit Vertrag",
                    destructive: true,
                    onClick: () => setRemoving(family),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  // Each figure of the status line counts one pill of the table.
  const countStatus = (status: FamilyChildren["status"]) =>
    families.filter((family) => family.status === status).length;
  const expired = countStatus("expired");
  const missing = countStatus("missing");

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList("/api/traeger/family-children/export", format),
    scope: "Alle Familien, ohne Suche. Jeder Download wird protokolliert.",
    fallbackName: "kinderzahl",
    errorObject: "die Kinderzahl der Familien",
    unavailable: families.length === 0,
  });
  return (
    <TenantPage
      title={billingAreaTitle("kinderzahl")}
      info="Hier steht, wie viele Kinder eine Familie hat, auch Geschwister ohne Betreuungsvertrag. Eltern geben die Zahl im Vertrag an. Du bestätigst oder änderst sie. Ein Vertrag ohne E-Mail-Adresse der Eltern ist eine eigene Familie. Eine Geschwisterregel nutzt die Zahl nur, wenn du das unter „Ermäßigungen“ einschaltest. moto speichert nur die Zahl, keine Namen der Geschwister. Jedes Öffnen dieser Seite steht im Zugriffsprotokoll."
      stats={
        families.length > 0 ? (
          <TenantPageStats
            // How many families, then one figure per pill of the table. The
            // line holds three figures: with expired numbers the total moves
            // into the first one („1 von 7 bestätigt“), so „ohne Angabe“
            // stays in view.
            items={[
              ...(expired > 0
                ? []
                : [
                    {
                      value: families.length,
                      label: families.length === 1 ? "Familie" : "Familien",
                    },
                  ]),
              {
                value:
                  expired > 0
                    ? `${countStatus("confirmed")} von ${families.length}`
                    : countStatus("confirmed"),
                label: "bestätigt",
              },
              ...(expired > 0 ? [{ value: expired, label: "abgelaufen" }] : []),
              { value: missing, label: "ohne Angabe" },
            ]}
          />
        ) : null
      }
      statsLoading={loading}
      overflowMenu={[
        ...exportItems,
        { kind: "separator" },
        {
          label: "Aus Datei nachtragen",
          description:
            "Öffnet das Nachtragen der Kinderzahlen aus einer CSV-Datei.",
          icon: <Upload className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/abrechnung/kinderzahl/import"),
          onClick: () => undefined,
        },
      ]}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Familie, Adresse, Vertrag oder Kind",
      }}
      tabs={billingTabs("kinderzahl")}
      error={loadError}
      loading={loading}
      overlays={
        <>
          <FamilyChildrenModal
            family={checking}
            onClose={() => setChecking(null)}
            onSaved={(next) => {
              void mutate(next, { revalidate: false });
              setChecking(null);
            }}
          />
          <ConfirmDeleteModal
            isOpen={removing !== null}
            onClose={() => {
              setRemoving(null);
              removeErrors.clear();
            }}
            onConfirm={() => void remove()}
            title="Kinderzahl entfernen?"
            description={
              removing
                ? `Die Kinderzahl von ${familyName(removing)} fällt weg. Neue Monatsläufe zählen dann nur die Kinder mit Vertrag. Ausgestellte Rechnungen bleiben, wie sie sind.`
                : ""
            }
            confirmLabel="Entfernen"
            loadingLabel="Wird entfernt …"
            gate={{ mode: "twoStep", firstStepLabel: "Ja, entfernen" }}
            loading={busy}
            error={removeErrors.error}
          />
        </>
      }
    >
      {data && families.length === 0 ? (
        <EmptyState
          icon={<MotoConceptIcon concept={parentsConcept} size={48} />}
          title="Noch keine Familie."
          description="Familien erscheinen hier, sobald ein Kind einen Betreuungsvertrag hat."
        />
      ) : null}
      {data && families.length > 0 && data.rules.length === 0 ? (
        <Alert
          type="info"
          message="Noch keine Geschwisterregel zählt diese Zahl. Schalte das bei der Regel unter „Ermäßigungen“ ein."
          action={
            <ButtonLink
              href={traegerPath("/traeger/abrechnung/ermaessigungen")}
              variant="surface"
              size="compact"
              tooltip="Öffnet die Ermäßigungen mit den Geschwisterregeln."
            >
              Zu den Ermäßigungen
            </ButtonLink>
          }
        />
      ) : null}
      {data && toCheck.length > 0 ? (
        <SectionCard
          title="Zu prüfen"
          titleBadge={
            <StatusBadge tone="warning" label={`${toCheck.length} offen`} />
          }
          description={checkCardText(toCheck, missing)}
          leading={
            <TriangleAlert
              className="text-moto-orange-strong mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
          }
        >
          <ResponsiveActionList>
            {(checksExpanded ? toCheck : toCheck.slice(0, INITIAL_CHECKS)).map(
              (family) => (
                <ResponsiveActionRow key={familyKey(family)}>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
                      {familyName(family)}
                      <StatusBadge
                        tone={STATUS_TONES[family.status]}
                        label={STATUS_LABELS[family.status]}
                      />
                    </p>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {checkReason(family, today)}
                    </p>
                  </div>
                  <ResponsiveRowActions>
                    <Button
                      type="button"
                      variant="surface"
                      size="compact"
                      aria-label={`Kinderzahl von ${familyName(family)} prüfen`}
                      tooltip="Öffnet ein Fenster, um die Kinderzahl zu bestätigen oder zu ändern."
                      onClick={() => setChecking(family)}
                    >
                      Prüfen
                    </Button>
                  </ResponsiveRowActions>
                </ResponsiveActionRow>
              ),
            )}
          </ResponsiveActionList>
          {toCheck.length > INITIAL_CHECKS ? (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              className="mt-3"
              aria-expanded={checksExpanded}
              tooltip={
                checksExpanded
                  ? "Zeigt wieder nur die ersten Familien der Liste."
                  : "Zeigt alle Familien, deren Kinderzahl du prüfen musst."
              }
              onClick={() => setChecksExpanded((open) => !open)}
            >
              {checksExpanded ? (
                <>
                  <ChevronUp className="size-4" aria-hidden="true" />
                  Weniger anzeigen
                </>
              ) : (
                <>
                  <ChevronDown className="size-4" aria-hidden="true" />
                  {toCheck.length - INITIAL_CHECKS} weitere anzeigen
                </>
              )}
            </Button>
          ) : null}
        </SectionCard>
      ) : null}
      {data && families.length > 0 ? (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={familyKey}
          // Six columns on a tablet: narrower cells keep the state pills
          // whole beside the row menu.
          dense
          stackedOnMobile
          emptyState={
            <EmptyState
              title="Keine Familie passt zur Suche."
              description="Ändere die Suche."
            />
          }
        />
      ) : null}
    </TenantPage>
  );
}
