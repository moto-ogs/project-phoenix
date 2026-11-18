"use client";

// Die Karten der Seite „Konten und Kostenstellen“ (#4821): auf welches
// Erlöskonto moto jede Leistung und jedes Angebot bucht, und welche
// Kostenstelle ab welchem Tag gilt. Eine Rechnung schreibt die Werte beim
// Ausstellen fest; eine Änderung hier gilt für neue Rechnungen.

import { Coins, Landmark, Layers } from "lucide-react";
import { useState } from "react";
import {
  costCenterError,
  costCenterOn,
  costCenterTimeline,
  effectiveHolidayCostCenter,
  effectiveRevenue,
  nextCostCenter,
  ownRevenueAccount,
  REVENUE_SERVICES,
  revenueAccountError,
} from "~/components/traeger/booking-accounts-format";
import { DATEV_SETTINGS_PATH } from "~/components/traeger/finance-export-datev";
import { Button, ButtonLink } from "~/components/ui/button";
import { ConfirmDeleteModal } from "~/components/ui/confirm-delete-modal";
import { ISODatePicker } from "~/components/ui/date-picker";
import { EditActions } from "~/components/ui/edit-actions";
import { FormErrorAlert } from "~/components/ui/form-error-alert";
import { InsetPanel } from "~/components/ui/inset-panel";
import { Input } from "~/components/ui/input";
import { ListGroupHeader } from "~/components/ui/list-group-header";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import {
  ResponsiveActionList,
  ResponsiveActionRow,
} from "~/components/ui/responsive-action-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { useApiFormError, useToast } from "~/contexts/ToastContext";
import { formatDate } from "~/lib/date-helpers";
import { createLogger } from "~/lib/logger";
import type {
  BookingAccounts,
  CostCenter,
  CostCenterScope,
  RevenueScope,
} from "~/lib/traeger-finance-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const logger = createLogger({ component: "BookingAccountsCards" });

type SubmitLike = { preventDefault: () => void };

const ACTIONS =
  "flex w-full flex-col gap-2 min-[480px]:w-auto min-[480px]:flex-row sm:justify-end";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The account as the screen shows it: the number and where it comes from. */
function AccountValue({
  account,
  source,
}: Readonly<{
  account: string;
  source: ReturnType<typeof effectiveRevenue>["source"];
}>) {
  if (source === "missing") {
    return <StatusBadge tone="warning" label="Kein Konto" />;
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-semibold text-gray-900 tabular-nums">
        {account}
      </span>
      {source === "own" ? null : (
        <StatusBadge
          tone="gray"
          size="xs"
          label={
            source === "service"
              ? "wie Monatsbeiträge"
              : source === "holiday"
                ? "wie Ferienbetreuung"
                : "Standard-Erlöskonto"
          }
        />
      )}
    </span>
  );
}

/** One revenue account row; „Ändern“ opens its field in the row. */
function RevenueRow({
  title,
  hint,
  scope,
  scopeId,
  page,
  onSave,
}: Readonly<{
  title: string;
  hint: string;
  scope: RevenueScope;
  scopeId: string;
  page: BookingAccounts;
  onSave: (
    scope: RevenueScope,
    scopeId: string,
    account: string,
  ) => Promise<void>;
}>) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();
  const effective = effectiveRevenue(page, scope, scopeId);
  const own = ownRevenueAccount(page, scope, scopeId);
  const fieldId = `revenue-${scope}-${scopeId}`;

  const submit = async (event: SubmitLike) => {
    event.preventDefault();
    if (draft === null) return;
    const invalid = revenueAccountError(draft);
    if (invalid) {
      errors.invalid("Bitte prüfe das Erlöskonto.", { account: invalid });
      return;
    }
    setSaving(true);
    try {
      await onSave(scope, scopeId, draft.trim());
      errors.clear();
      setDraft(null);
    } catch (err) {
      logger.error("traeger_revenue_account_save_failed", {
        error: errorText(err),
      });
      await errors.show(err, { object: `das Erlöskonto für ${title}` });
    } finally {
      setSaving(false);
    }
  };

  if (draft !== null) {
    return (
      <li className="py-3 first:pt-0 last:pb-0 sm:col-span-2">
        <form onSubmit={(event) => void submit(event)} noValidate>
          <InsetPanel padding="md" className="flex flex-col gap-3">
            <Input
              id={fieldId}
              name="account"
              label={`Erlöskonto für ${title}`}
              hint="Leer lassen: Es gilt das Konto darüber."
              inputMode="numeric"
              autoComplete="off"
              controlSize="compact"
              className="font-mono sm:max-w-48"
              value={draft}
              error={errors.fieldError("account")}
              onChange={(event) => setDraft(event.target.value)}
            />
            <FormErrorAlert message={errors.error} />
            <EditActions
              onCancel={() => {
                errors.clear();
                setDraft(null);
              }}
              saving={saving}
            />
          </InsetPanel>
        </form>
      </li>
    );
  }
  return (
    <ResponsiveActionRow>
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 sm:w-64">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-sm text-gray-600">{hint}</p>
        </div>
        <AccountValue account={effective.account} source={effective.source} />
      </div>
      <div className={ACTIONS}>
        <Button
          type="button"
          variant="surface"
          size="compact"
          aria-label={`Erlöskonto für ${title} ändern`}
          tooltip={`Öffnet das Erlöskonto für ${title} zum Bearbeiten.`}
          onClick={() => setDraft(own)}
        >
          Ändern
        </Button>
      </div>
    </ResponsiveActionRow>
  );
}

/**
 * The revenue accounts: the standard of the DATEV values, one per Leistung
 * and one per Angebot of the monthly contributions.
 */
export function RevenueAccountsCard({
  page,
  onSave,
}: Readonly<{
  page: BookingAccounts;
  onSave: (
    scope: RevenueScope,
    scopeId: string,
    account: string,
  ) => Promise<void>;
}>) {
  const schoolName = (id: string) =>
    page.schools.find((school) => school.id === id)?.name ?? "Schule";
  return (
    <SectionCard
      title="Erlöskonten"
      icon={Coins}
      description="Auf diese Sachkonten bucht moto die Beiträge. Hat eine Leistung oder ein Angebot kein eigenes Konto, gilt das Konto darüber."
    >
      <ResponsiveActionList>
        <ResponsiveActionRow>
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
            <div className="min-w-0 sm:w-64">
              <p className="text-sm font-semibold text-gray-900">
                Standard-Erlöskonto
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                Gilt für alles ohne eigenes Konto
              </p>
            </div>
            <AccountValue
              account={page.standardAccount}
              source={page.standardAccount ? "own" : "missing"}
            />
          </div>
          <div className={ACTIONS}>
            <ButtonLink
              href={traegerPath(DATEV_SETTINGS_PATH)}
              variant="surface"
              size="compact"
              aria-label="Standard-Erlöskonto in den DATEV-Werten ändern"
              tooltip="Öffnet die DATEV-Werte in den Einstellungen."
            >
              DATEV-Werte
            </ButtonLink>
          </div>
        </ResponsiveActionRow>
        {REVENUE_SERVICES.map((service) => (
          <RevenueRow
            key={service.scope}
            title={service.label}
            hint={service.hint}
            scope={service.scope}
            scopeId="0"
            page={page}
            onSave={onSave}
          />
        ))}
      </ResponsiveActionList>
      {page.offerings.length > 0 ? (
        <div className="mt-5 flex flex-col gap-3">
          <ListGroupHeader
            title="Angebote der Monatsbeiträge"
            meta="Eigenes Konto nur, wenn dein Steuerbüro es so will"
          />
          <ResponsiveActionList>
            {page.offerings.map((offering) => (
              <RevenueRow
                key={offering.offeringId}
                title={offering.moduleNames.join(", ") || "Angebot"}
                hint={schoolName(offering.schoolId)}
                scope="offering"
                scopeId={offering.offeringId}
                page={page}
                onSave={onSave}
              />
            ))}
          </ResponsiveActionList>
        </div>
      ) : null}
    </SectionCard>
  );
}

/** The cost center a scope without its own books on, and whose it is. */
type InheritedCostCenter = { readonly code: string; readonly label: string };

/**
 * What holds now and what comes next, in words. A scope without its own
 * cost center shows the one it books on instead, with whose it is.
 */
function CostCenterState({
  timeline,
  today,
  required,
  inherited,
  none,
}: Readonly<{
  timeline: readonly CostCenter[];
  today: string;
  required: boolean;
  inherited?: InheritedCostCenter;
  none: string;
}>) {
  const current = costCenterOn(timeline, today);
  const next = nextCostCenter(timeline, today);
  return (
    <span className="flex max-w-full min-w-0 flex-col gap-1">
      {current?.code ? (
        <span className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
          <span className="max-w-full min-w-0 font-mono text-sm font-semibold break-all text-gray-900">
            {current.code}
          </span>
          <span className="text-sm text-gray-600">
            seit {formatDate(current.validFrom)}
          </span>
        </span>
      ) : inherited ? (
        <span className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
          <span className="max-w-full min-w-0 font-mono text-sm font-semibold break-all text-gray-900">
            {inherited.code}
          </span>
          <StatusBadge tone="gray" size="xs" label={inherited.label} />
        </span>
      ) : required ? (
        <StatusBadge tone="warning" label="Keine Kostenstelle" />
      ) : (
        <span className="text-sm text-gray-600">Keine Kostenstelle</span>
      )}
      {next ? (
        <span className="text-sm text-gray-600">
          Ab {formatDate(next.validFrom)}:{" "}
          {next.code ? (
            <span className="font-mono break-all text-gray-900">
              {next.code}
            </span>
          ) : (
            `${none} mehr`
          )}
        </span>
      ) : null}
    </span>
  );
}

/** The form for a new cost center of a scope, inside its row. */
function CostCenterForm({
  title,
  today,
  none,
  onCancel,
  onAdd,
}: Readonly<{
  title: string;
  today: string;
  none: string;
  onCancel: () => void;
  onAdd: (validFrom: string, code: string) => Promise<void>;
}>) {
  const [validFrom, setValidFrom] = useState(today);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const errors = useApiFormError();

  const submit = async (event: SubmitLike) => {
    event.preventDefault();
    const invalid = costCenterError(code);
    if (!validFrom || invalid) {
      errors.invalid("Bitte prüfe die markierten Felder.", {
        ...(validFrom ? {} : { valid_from: "Bitte wähle einen Tag." }),
        ...(invalid ? { code: invalid } : {}),
      });
      return;
    }
    setSaving(true);
    try {
      await onAdd(validFrom, code.trim());
    } catch (err) {
      logger.error("traeger_cost_center_add_failed", { error: errorText(err) });
      await errors.show(err, { object: `die Kostenstelle für ${title}` });
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <InsetPanel padding="md" className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,16rem)]">
          <ISODatePicker
            label="Gilt ab"
            value={validFrom}
            onChange={setValidFrom}
            error={errors.fieldError("valid_from")}
          />
          <Input
            name="code"
            label="Kostenstelle"
            hint={`Leer lassen: Ab diesem Tag gibt es ${none.replace(" Kostenstelle", "")}.`}
            autoComplete="off"
            controlSize="compact"
            className="font-mono"
            value={code}
            error={errors.fieldError("code")}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <FormErrorAlert message={errors.error} />
        <EditActions onCancel={onCancel} saving={saving} />
      </InsetPanel>
    </form>
  );
}

/**
 * One scope with its cost centers, the form to add one and the history.
 * `object` names the scope in a sentence („… für GS Ispringen“).
 */
function CostCenterRow({
  title,
  hint,
  object,
  scope,
  scopeId,
  page,
  today,
  required,
  inherited,
  onAdd,
  onDelete,
}: Readonly<{
  title: string;
  hint: string;
  object: string;
  scope: CostCenterScope;
  scopeId: string;
  page: BookingAccounts;
  today: string;
  required: boolean;
  inherited?: InheritedCostCenter;
  onAdd: (
    scope: CostCenterScope,
    scopeId: string,
    validFrom: string,
    code: string,
  ) => Promise<void>;
  onDelete: (center: CostCenter, object: string) => void;
}>) {
  const [adding, setAdding] = useState(false);
  const [history, setHistory] = useState(false);
  const timeline = costCenterTimeline(page.costCenters, scope, scopeId);
  const label = scope === "offering" ? "KOST2" : "KOST1";
  // An ended holiday cost center of a school is no end of all: its weeks
  // book on the school's again.
  const none =
    scope === "school_holiday"
      ? "keine eigene Kostenstelle"
      : "keine Kostenstelle";
  return (
    <ResponsiveActionRow>
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0 sm:w-64">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          <p className="mt-0.5 text-sm text-gray-600">{hint}</p>
        </div>
        <div className="flex max-w-full min-w-0 flex-col items-start gap-1">
          <CostCenterState
            timeline={timeline}
            today={today}
            required={required}
            inherited={inherited}
            none={none}
          />
          {timeline.length > 0 ? (
            <Button
              type="button"
              variant="link"
              size="compact"
              aria-expanded={history}
              aria-label={`Verlauf der Kostenstellen für ${object}`}
              tooltip={
                history
                  ? "Blendet die früheren und geplanten Kostenstellen wieder aus."
                  : "Zeigt alle früheren und geplanten Kostenstellen mit Startdatum."
              }
              onClick={() => setHistory((shown) => !shown)}
            >
              {history
                ? "Verlauf ausblenden"
                : `Verlauf ansehen (${timeline.length})`}
            </Button>
          ) : null}
        </div>
      </div>
      <div className={ACTIONS}>
        <Button
          type="button"
          variant="surface"
          size="compact"
          aria-label={`Neue ${label} für ${object}`}
          disabled={adding}
          tooltip="Öffnet ein Formular für eine Kostenstelle ab einem gewählten Tag."
          onClick={() => setAdding(true)}
        >
          Neue Kostenstelle
        </Button>
      </div>
      {adding ? (
        <div className="mt-3 sm:col-span-2">
          <CostCenterForm
            title={object}
            today={today}
            none={none}
            onCancel={() => setAdding(false)}
            onAdd={async (validFrom, code) => {
              await onAdd(scope, scopeId, validFrom, code);
              setAdding(false);
            }}
          />
        </div>
      ) : null}
      {history && timeline.length > 0 ? (
        <InsetPanel padding="sm" className="mt-3 min-w-0 sm:col-span-2">
          <ol
            className="divide-y divide-gray-100"
            aria-label={`Verlauf für ${object}`}
          >
            {[...timeline].reverse().map((center) => (
              <li
                key={center.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                  <span className="text-gray-600 tabular-nums">
                    ab {formatDate(center.validFrom)}
                  </span>
                  {center.code ? (
                    <span className="max-w-full min-w-0 font-mono break-all text-gray-900">
                      {center.code}
                    </span>
                  ) : (
                    <span className="text-gray-600">{none}</span>
                  )}
                  {center.validFrom > today ? (
                    <StatusBadge tone="blue" size="xs" label="geplant" />
                  ) : null}
                </span>
                <OverflowMenu
                  ariaLabel={`Aktionen für die Kostenstelle ab ${formatDate(center.validFrom)} für ${object}`}
                  triggerSize="sm"
                  items={[
                    {
                      label: "Löschen",
                      description: "Ausgestellte Rechnungen behalten sie.",
                      destructive: true,
                      onClick: () => onDelete(center, object),
                    },
                  ]}
                />
              </li>
            ))}
          </ol>
        </InsetPanel>
      ) : null}
    </ResponsiveActionRow>
  );
}

type CostCenterScopeRow = {
  readonly key: string;
  readonly title: string;
  readonly hint: string;
  readonly object: string;
  readonly scope: CostCenterScope;
  readonly scopeId: string;
  readonly inherited?: InheritedCostCenter;
};

/** Whose cost center the holiday care of a school books on without its own. */
const INHERITED_LABEL: Partial<
  Record<ReturnType<typeof effectiveHolidayCostCenter>["source"], string>
> = { school: "wie Monatsbeiträge", fallback: "Ersatz-Kostenstelle" };

/** Rows under one name; without a name the rows stand alone. */
type CostCenterGroup = {
  readonly key: string;
  readonly title: string | null;
  readonly rows: readonly CostCenterScopeRow[];
};

/**
 * KOST1: each school with the cost center of its monthly contributions
 * and the one of its holiday care (#7357), then the one every holiday week
 * falls back on. A holiday row without its own shows where its weeks book.
 */
function kost1Groups(page: BookingAccounts, today: string): CostCenterGroup[] {
  return [
    ...page.schools.map((school) => {
      const holiday = effectiveHolidayCostCenter(
        page.costCenters,
        school.id,
        today,
      );
      return {
        key: `school-${school.id}`,
        title: school.name,
        rows: [
          {
            key: "school",
            title: "Monatsbeiträge und Mensa",
            hint: "Rechnungen der Monatsläufe",
            object: school.name,
            scope: "school" as const,
            scopeId: school.id,
          },
          {
            key: "school_holiday",
            title: "Ferienbetreuung",
            hint: "Ferienwochen an dieser Schule",
            object: `die Ferienbetreuung an ${school.name}`,
            scope: "school_holiday" as const,
            scopeId: school.id,
            inherited: INHERITED_LABEL[holiday.source]
              ? { code: holiday.code, label: INHERITED_LABEL[holiday.source]! }
              : undefined,
          },
        ],
      };
    }),
    {
      key: "holiday",
      title: "Alle Schulen",
      rows: [
        {
          key: "holiday",
          title: "Ersatz für die Ferienbetreuung",
          hint: "Für Ferienwochen an einer Schule ohne Kostenstelle",
          object: "den Ersatz der Ferienbetreuung",
          scope: "holiday",
          scopeId: "0",
        },
      ],
    },
  ];
}

/**
 * The cost centers: KOST1 of each school, of its holiday care and of the
 * holiday care of the Träger, or KOST2 of each Angebot. A cost center holds
 * from its day until the next one.
 */
export function CostCentersCard({
  kind,
  page,
  today,
  onAdd,
  onDeleted,
}: Readonly<{
  kind: "kost1" | "kost2";
  page: BookingAccounts;
  today: string;
  onAdd: (
    scope: CostCenterScope,
    scopeId: string,
    validFrom: string,
    code: string,
  ) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
}>) {
  const [deleting, setDeleting] = useState<{
    center: CostCenter;
    object: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const deleteErrors = useApiFormError();
  const { success } = useToast();
  const schoolName = (id: string) =>
    page.schools.find((school) => school.id === id)?.name ?? "Schule";
  const groups: CostCenterGroup[] =
    kind === "kost1"
      ? kost1Groups(page, today)
      : page.offerings.length === 0
        ? []
        : [
            {
              key: "offerings",
              title: null,
              rows: page.offerings.map((offering) => {
                const title = offering.moduleNames.join(", ") || "Angebot";
                return {
                  key: `offering-${offering.offeringId}`,
                  title,
                  hint: schoolName(offering.schoolId),
                  object: title,
                  scope: "offering" as const,
                  scopeId: offering.offeringId,
                };
              }),
            },
          ];
  const required = kind === "kost1" && page.costCenterRequired;

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await onDeleted(deleting.center.id);
      success("Die Kostenstelle ist gelöscht.");
      deleteErrors.clear();
      setDeleting(null);
    } catch (err) {
      logger.error("traeger_cost_center_delete_failed", {
        error: errorText(err),
      });
      await deleteErrors.show(err, { object: "die Kostenstelle" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title={
        kind === "kost1"
          ? "Kostenstellen (KOST1)"
          : "Zweite Kostenstelle (KOST2)"
      }
      icon={kind === "kost1" ? Landmark : Layers}
      titleBadge={
        kind === "kost1" ? (
          required ? (
            <StatusBadge tone="orange" label="Pflicht" />
          ) : (
            <StatusBadge tone="outline" label="Freiwillig" />
          )
        ) : (
          <StatusBadge tone="outline" label="Freiwillig" />
        )
      }
      description={
        kind === "kost1"
          ? "Jede Schule kann eine Kostenstelle haben, für ihre Ferienbetreuung auch eine eigene. Eine Kostenstelle gilt ab ihrem Tag bis zur nächsten."
          : "Nur, wenn dein Steuerbüro die Angebote getrennt auswerten will."
      }
    >
      {groups.length === 0 ? (
        <p className="text-sm text-gray-600">
          Angebote stehen hier, sobald sie einen Preis haben.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const rows = (
              <ResponsiveActionList>
                {group.rows.map((row) => (
                  <CostCenterRow
                    key={row.key}
                    title={row.title}
                    hint={row.hint}
                    object={row.object}
                    scope={row.scope}
                    scopeId={row.scopeId}
                    page={page}
                    today={today}
                    required={required}
                    inherited={row.inherited}
                    onAdd={onAdd}
                    onDelete={(center, object) =>
                      setDeleting({ center, object })
                    }
                  />
                ))}
              </ResponsiveActionList>
            );
            return group.title === null ? (
              <div key={group.key}>{rows}</div>
            ) : (
              <div
                key={group.key}
                role="group"
                aria-label={group.title}
                className="flex flex-col gap-3"
              >
                <ListGroupHeader title={group.title} />
                {rows}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDeleteModal
        isOpen={deleting !== null}
        title="Kostenstelle löschen?"
        description={
          deleting
            ? `${deleting.center.code || "„Keine Kostenstelle“"} ab ${formatDate(deleting.center.validFrom)} für ${deleting.object}. Schon ausgestellte Rechnungen behalten ihre Kostenstelle.`
            : ""
        }
        gate={{ mode: "twoStep", firstStepLabel: "Löschen" }}
        onConfirm={confirmDelete}
        onClose={() => {
          deleteErrors.clear();
          setDeleting(null);
        }}
        loading={busy}
        error={deleteErrors.error}
      />
    </SectionCard>
  );
}
