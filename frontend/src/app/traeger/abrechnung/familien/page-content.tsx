"use client";

import { bffFile } from "~/lib/bff-fetch";

// Rechnungen und Beträge je Familie (#4691): je Familie die Zahl der
// Rechnungen, wer zahlt und die Summen ausgestellt, storniert,
// gutgeschrieben und die offene Forderung. Eine Familie sind alle Schreiben
// an dieselbe E-Mail-Adresse. moto gleicht keine Zahlungseingänge ab
// (#6348): offen ist, was die Rechnungen nach Storno und Gutschrift noch
// verlangen, nie ein geprüfter Zahlungsrückstand. Nur die Rolle
// mit dem Recht „Abrechnung“ sieht die Seite. Ein Klick öffnet die Familie.
// Seit #6692 stehen hier auch Familien, die nur zur Ferienbetreuung
// angemeldet sind, schon vor der ersten Rechnung. Jede Familie hat ihre
// Debitorennummer; das Büro ändert sie über das Menü in ihrer Zelle. Die
// Nummer prüft das Format des Trägers (#6675). Führt der Träger die Nummer
// je Kind (#7007), stehen in der Zelle die Kinder mit ihren Nummern, und
// Familien mit Vertrag stehen hier schon vor der ersten Rechnung. Seit
// #7770 legt das Büro hier auch den Zahlungsweg einer Familie fest, schon
// vor ihrer ersten Rechnung: die Spalte „Zahlung“ nennt ihn, das Zeilenmenü
// öffnet die Seite dazu, und ein Filter zeigt die Familien ohne Angabe.

import { CreditCard, Pencil, Plus, UsersRound } from "lucide-react";
import { familyKeyLabel } from "~/lib/family-key";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import {
  BillingAmountCards,
  sumAmounts,
} from "~/components/traeger/billing-amount-cards";
import {
  billingAreaTitle,
  billingTabs,
  familyMatches,
  familyName,
  familySortName,
  PAYMENT_TONES,
  paymentLabel,
} from "~/components/traeger/billing-family-format";
import {
  type FamilyPaymentFilter,
  PAYMENT_METHOD_LABELS,
  familiesPath,
  familyPaymentFilterOf,
  familyPaymentPath,
  paymentMethodsText,
} from "~/components/traeger/billing-payment-format";
import { formatEuro } from "~/components/traeger/contribution-format";
import { emptySearchText } from "~/components/traeger/empty-search";
import { EmailText } from "~/components/traeger/email-text";
import { DEBTOR_NUMBER_TEXT_CLASS } from "~/components/traeger/family-debtor-number";
import {
  ChildDebtorNumbersModal,
  childLabel,
} from "~/components/traeger/child-debtor-numbers-modal";
import { FamilyDebtorNumberModal } from "~/components/traeger/family-debtor-number-modal";
import { useDebtorNumberSettings } from "~/components/traeger/use-debtor-number-format";
import { useTraegerResource } from "~/components/traeger/use-traeger-resource";
import { useTraegerListExportItems } from "~/components/traeger/traeger-list-export-menu";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { OverflowMenu } from "~/components/ui/page-header/OverflowMenu";
import NavigationLink from "~/components/ui/navigation-link";
import type {
  ActiveFilter,
  FilterConfig,
  OverflowMenuItem,
} from "~/components/ui/page-header/types";
import { StatusBadge } from "~/components/ui/status-badge";
import { TenantPage, TenantPageStats } from "~/components/ui/tenant-page";
import { ListSkeleton } from "~/components/ui/page-skeletons";
import { Button } from "~/components/ui/button";
import { useSwrLoadError } from "~/lib/hooks/use-swr-load-error";
import { parentsConcept } from "~/lib/concepts/parents";
import { useInvalidateFamily } from "~/lib/swr";
import { traegerBillingKeys } from "~/lib/swr/traeger-billing-keys";
import {
  type BillingFamily,
  fetchBillingFamilies,
  fetchFamilyChildren,
  withFamilyChildren,
} from "~/lib/traeger-billing-families-api";
import {
  downloadTraegerList,
  listExportQuery,
} from "~/lib/traeger-list-export";
import { traegerPath } from "~/lib/traeger-url";
import { labelOf } from "~/lib/label-of";

type OpenFilter = "" | "offen" | "ausgeglichen";

const OPEN_FILTER_LABELS: Record<Exclude<OpenFilter, "">, string> = {
  offen: "Mit offener Forderung",
  ausgeglichen: "Ohne offene Forderung",
};

type NumberFilter = "" | "ohne" | "mit";

const NUMBER_FILTER_LABELS: Record<Exclude<NumberFilter, "">, string> = {
  ohne: "Ohne Debitorennummer",
  mit: "Mit Debitorennummer",
};

const PAYMENT_FILTER_LABELS: Record<FamilyPaymentFilter, string> = {
  ohne: "Zahlungsweg nicht festgelegt",
  lastschrift: "Lastschrift festgelegt",
  ueberweisung: "Überweisung festgelegt",
};

function euroCell(cents: number) {
  return cents === 0 ? (
    <span className="text-gray-500 tabular-nums">{formatEuro(0)}</span>
  ) : (
    <span className="tabular-nums">{formatEuro(cents)}</span>
  );
}

/** The page of a family with documents. */
function familyHref(family: BillingFamily): string {
  return traegerPath(
    `/traeger/abrechnung/familien/${encodeURIComponent(family.id)}`,
  );
}

/** Whether the Träger keeps the number per child: the family has children. */
function perChild(family: BillingFamily): boolean {
  return family.children !== undefined;
}

/**
 * A family without a number: without its own, or with a child without one
 * when the Träger keeps the number per child (#7007).
 */
function lacksNumber(family: BillingFamily): boolean {
  if (perChild(family)) {
    return (family.children ?? []).some((child) => !child.debtorNumber);
  }
  return !family.familyDebtorNumber;
}

/** The numbers the family's invoices copied besides the family's own. */
function otherInvoiceNumbers(family: BillingFamily): string[] {
  return family.debtorNumbers.filter(
    (number) => number !== family.familyDebtorNumber,
  );
}

/**
 * The entry of the row menu that opens recipient and payment of the family
 * (#7770); none for a family without a contract, whose invoices come from
 * the holiday care alone.
 */
function paymentMenuItems(
  family: BillingFamily,
  filter: FamilyPaymentFilter | "",
): OverflowMenuItem[] {
  if (!family.contractId) return [];
  return [
    {
      label: "Empfänger und Zahlung ändern",
      description:
        "Öffnet die Seite für Empfänger, Zahlungsweg, Zahltag und Debitorennummer",
      icon: <CreditCard aria-hidden="true" className="h-4 w-4" />,
      href: familyPaymentPath(family.contractId, { filter }),
      onClick: () => undefined,
    },
  ];
}

/** What the cells of a row need besides the family. */
interface RowActions {
  readonly onChange: (family: BillingFamily) => void;
  /** The payment filter of the list, so the payment page leads back to it. */
  readonly paymentFilter: FamilyPaymentFilter | "";
}

/**
 * The family's number and its row menu (#6692). Historical invoice numbers
 * stand below it; an absent family number shows „–“.
 */
function DebtorCell({
  family,
  onChange,
  paymentFilter,
}: Readonly<{ family: BillingFamily } & RowActions>) {
  if (perChild(family)) {
    return (
      <ChildDebtorCell
        family={family}
        onChange={onChange}
        paymentFilter={paymentFilter}
      />
    );
  }
  const others = otherInvoiceNumbers(family);
  const name = familyName(family) || familyKeyLabel(family.familyEmail);
  const number = family.familyDebtorNumber;
  const numberItem: OverflowMenuItem = {
    label: number ? "Debitorennummer ändern" : "Debitorennummer eintragen",
    description: number
      ? "Öffnet ein Fenster, um die Debitorennummer zu ändern"
      : "Öffnet ein Fenster, um die Debitorennummer einzutragen",
    icon: number ? (
      <Pencil aria-hidden="true" className="h-4 w-4" />
    ) : (
      <Plus aria-hidden="true" className="h-4 w-4" />
    ),
    onClick: () => onChange(family),
  };
  return (
    <span className="block min-w-0 sm:w-40">
      <span className="flex min-w-0 items-center justify-between gap-3">
        {number ? (
          <span
            className={`block min-w-0 text-sm break-all ${DEBTOR_NUMBER_TEXT_CLASS}`}
          >
            {number}
          </span>
        ) : (
          <span className="block text-sm text-gray-500">–</span>
        )}
        <span
          data-row-control
          role="presentation"
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <OverflowMenu
            ariaLabel={`Aktionen für ${name}`}
            items={[
              // A family known by its contract alone has no row the number
              // dialog could write to: its number is set on the page for
              // recipient and payment, which creates the row.
              ...(family.contractOnly ? [] : [numberItem]),
              ...paymentMenuItems(family, paymentFilter),
            ]}
          />
        </span>
      </span>
      {others.length > 0 ? (
        // Historical numbers wrap within the available width on phones.
        <span className="block text-xs wrap-anywhere text-gray-500 max-sm:w-0 max-sm:min-w-full">
          Auf Rechnungen:{" "}
          <span className="font-medium text-gray-700 tabular-nums">
            {others.join(", ")}
          </span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The children of the family with their own numbers (#7007) and the row
 * menu. A child without a number shows „–“.
 */
function ChildDebtorCell({
  family,
  onChange,
  paymentFilter,
}: Readonly<{ family: BillingFamily } & RowActions>) {
  const children = family.children ?? [];
  const name = familyName(family) || familyKeyLabel(family.familyEmail);
  const complete = children.every((child) => child.debtorNumber);
  const menuItems: OverflowMenuItem[] = [
    ...(children.length > 0
      ? [
          {
            label: complete
              ? "Nummern der Kinder ändern"
              : "Nummern der Kinder eintragen",
            description: complete
              ? "Öffnet ein Fenster, um die Nummern der Kinder zu ändern"
              : "Öffnet ein Fenster, um die Nummern der Kinder einzutragen",
            icon: complete ? (
              <Pencil aria-hidden="true" className="h-4 w-4" />
            ) : (
              <Plus aria-hidden="true" className="h-4 w-4" />
            ),
            onClick: () => onChange(family),
          },
        ]
      : []),
    ...paymentMenuItems(family, paymentFilter),
  ];
  return (
    <span className="flex min-w-0 items-start justify-between gap-3 sm:w-56">
      {children.length > 0 ? (
        <span className="block min-w-0 space-y-0.5">
          {children.map((child) => (
            <span
              key={childLabel(child)}
              className="flex min-w-0 items-baseline gap-2 text-sm"
            >
              <span className="min-w-0 truncate text-gray-600">
                {child.firstName}
              </span>
              {child.debtorNumber ? (
                <span
                  className={`shrink-0 break-all ${DEBTOR_NUMBER_TEXT_CLASS}`}
                >
                  {child.debtorNumber}
                </span>
              ) : (
                <span className="shrink-0 text-gray-500">–</span>
              )}
            </span>
          ))}
        </span>
      ) : (
        <span className="block text-sm text-gray-500">
          Kein Kind mit Vertrag
        </span>
      )}
      {menuItems.length > 0 ? (
        <span
          data-row-control
          role="presentation"
          className="shrink-0"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <OverflowMenu ariaLabel={`Aktionen für ${name}`} items={menuItems} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * How the family pays (#7770): the payment method the office set for it,
 * which its next invoice takes, and the methods its issued invoices took
 * when they differ. null when neither is known.
 */
function PaymentMethodLines({ family }: Readonly<{ family: BillingFamily }>) {
  const set = family.familyPaymentMethod
    ? PAYMENT_METHOD_LABELS[family.familyPaymentMethod]
    : null;
  const invoiced = paymentMethodsText(family.paymentMethods);
  if (!set) {
    return invoiced ? (
      <span className="block text-sm text-gray-600">{invoiced}</span>
    ) : null;
  }
  return (
    <>
      <span className="block text-sm text-gray-900">
        <span className="text-gray-500">Festgelegt: </span>
        {set}
      </span>
      {invoiced && invoiced !== set ? (
        <span className="block text-xs text-gray-500">
          Auf Rechnungen: {invoiced}
        </span>
      ) : null}
    </>
  );
}

function familyColumns(
  actions: RowActions,
  childNumbers: boolean,
): DataTableColumn<BillingFamily>[] {
  const debtorHeader = childNumbers ? "Nummern der Kinder" : "Debitorennummer";
  return [
    {
      key: "family",
      header: "Familie",
      sortValue: familySortName,
      render: (family) => (
        <span className="flex min-w-0 items-center gap-3">
          <MotoConceptIcon
            concept={parentsConcept}
            size={18}
            className="hidden shrink-0 sm:block"
          />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              {family.hasDocuments ? (
                <NavigationLink
                  href={familyHref(family)}
                  className="truncate font-medium text-gray-900 hover:underline"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) =>
                    event.stopPropagation()
                  }
                >
                  {familyName(family) || familyKeyLabel(family.familyEmail)}
                </NavigationLink>
              ) : (
                <span className="truncate font-medium text-gray-900">
                  {familyName(family) || familyKeyLabel(family.familyEmail)}
                </span>
              )}
              {family.holidayOnly ? (
                <span className="shrink-0">
                  <StatusBadge label="Nur Ferien" tone="outline" />
                </span>
              ) : null}
            </span>
            {/* The address gives way first: on a tablet all four sums stay
                in view beside it. There it wraps after its „@“ instead of
                being cut, so the whole address stays readable. */}
            <span className="block max-w-56 truncate text-sm text-gray-500 md:max-xl:max-w-36 md:max-xl:whitespace-normal">
              <EmailText email={family.recipientEmail} />
            </span>
          </span>
        </span>
      ),
      stacked: "title",
    },
    {
      key: "debtor",
      header: debtorHeader,
      stackedLabel: false,
      stackedRender: (family) => (
        <span className="block min-w-0">
          <span className="block text-xs wrap-anywhere text-gray-500">
            {debtorHeader}
          </span>
          <DebtorCell family={family} {...actions} />
          {/* A phone shows no „Zahlung“ column: the payment method the
              office set stands here, so it can be checked there too. */}
          {family.familyPaymentMethod ||
          paymentMethodsText(family.paymentMethods) ? (
            <span className="mt-1 block">
              <span className="block text-xs text-gray-500">Zahlungsweg</span>
              <PaymentMethodLines family={family} />
            </span>
          ) : null}
        </span>
      ),
      sortValue: (family) =>
        (perChild(family)
          ? family.children?.find((child) => child.debtorNumber)?.debtorNumber
          : family.familyDebtorNumber) || null,
      render: (family) => <DebtorCell family={family} {...actions} />,
    },
    {
      key: "payment",
      header: "Zahlung",
      sortValue: (family) =>
        family.familyPaymentMethod
          ? PAYMENT_METHOD_LABELS[family.familyPaymentMethod]
          : null,
      render: (family) => {
        const method =
          family.familyPaymentMethod ||
          paymentMethodsText(family.paymentMethods);
        if (family.payments.length === 0 && !method) return "–";
        // Who pays and how, in one column so the amounts stay in view.
        return (
          <span className="block max-w-48 min-w-0 space-y-1">
            {family.payments.length > 0 ? (
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {family.payments.map((payment) => (
                  <StatusBadge
                    key={`${payment.kind}-${payment.costBearerName}`}
                    label={paymentLabel(payment)}
                    tone={labelOf(PAYMENT_TONES, payment.kind, "gray")}
                    truncate
                  />
                ))}
              </span>
            ) : null}
            <PaymentMethodLines family={family} />
          </span>
        );
      },
    },
    {
      key: "issued",
      header: "Ausgestellt",
      align: "right",
      sortValue: (family) => family.issuedCents,
      render: (family) => euroCell(family.issuedCents),
      stacked: "hidden",
    },
    {
      key: "cancelled",
      header: "Storniert",
      align: "right",
      sortValue: (family) => family.cancelledCents,
      render: (family) => euroCell(family.cancelledCents),
      stacked: "hidden",
    },
    {
      key: "credited",
      header: "Gutgeschrieben",
      align: "right",
      sortValue: (family) => family.creditedCents,
      render: (family) => euroCell(family.creditedCents),
      stacked: "hidden",
    },
    {
      key: "open",
      header: "Offene Forderung",
      align: "right",
      sortValue: (family) => family.openCents,
      render: (family) =>
        family.openCents > 0 ? (
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatEuro(family.openCents)}
          </span>
        ) : (
          <span className="text-gray-500 tabular-nums">{formatEuro(0)}</span>
        ),
      stacked: "meta",
    },
  ];
}

function matchesNumberFilter(family: BillingFamily, filter: NumberFilter) {
  if (filter === "ohne") return lacksNumber(family);
  if (filter === "mit") return !lacksNumber(family);
  return true;
}

function matchesPaymentFilter(
  family: BillingFamily,
  filter: FamilyPaymentFilter | "",
) {
  if (filter === "ohne") return !family.familyPaymentMethod;
  if (filter === "lastschrift") {
    return family.familyPaymentMethod === "direct_debit";
  }
  if (filter === "ueberweisung") {
    return family.familyPaymentMethod === "transfer";
  }
  return true;
}

function matchesOpenFilter(family: BillingFamily, filter: OpenFilter) {
  if (filter === "offen") return family.openCents > 0;
  if (filter === "ausgeglichen") return family.openCents === 0;
  return true;
}

export default function TraegerBillingFamiliesPage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense
      fallback={
        <TenantPage
          title={billingAreaTitle("familien")}
          tabs={billingTabs("familien")}
          loading={<ListSkeleton rows={6} avatar={false} />}
        />
      }
    >
      <BillingFamiliesContent />
    </Suspense>
  );
}

function BillingFamiliesContent() {
  const router = useRouter();
  // The payment filter lives in the address, so the list comes back
  // filtered after a family's payment was saved on its own page (#7770).
  const paymentFilter = familyPaymentFilterOf(useSearchParams().get("zahlung"));
  const setPaymentFilter = useCallback(
    (filter: FamilyPaymentFilter | "") =>
      router.replace(familiesPath(filter), { scroll: false }),
    [router],
  );
  const [search, setSearch] = useState("");
  const [openFilter, setOpenFilter] = useState<OpenFilter>("");
  const [numberFilter, setNumberFilter] = useState<NumberFilter>("");
  const [changing, setChanging] = useState<BillingFamily | null>(null);
  const {
    settings,
    error: settingsError,
    reload: reloadSettings,
  } = useDebtorNumberSettings();
  const format = settings?.format;
  const scope = settings?.scope;
  const settingsLoad = useSwrLoadError(
    settingsError,
    "die Einstellungen der Debitorennummer",
    reloadSettings,
  );

  // Without the scope the list waits: it cannot tell which numbers apply.
  const listed = useTraegerResource(
    scope ? traegerBillingKeys.families() : null,
    fetchBillingFamilies,
    "die Liste der Familien",
  );
  // The families with a contract come with a read of their own: they stand
  // in the list before their first invoice, so the office can set how they
  // pay (#7770). With a number per child they bring the children's numbers;
  // with a number per payer the read asks for no child and no number.
  const perChildScope = scope === "child";
  const children = useTraegerResource(
    scope
      ? perChildScope
        ? traegerBillingKeys.familyChildren()
        : traegerBillingKeys.familyContracts()
      : null,
    () => fetchFamilyChildren(perChildScope),
    "die Liste der Familien",
  );
  const families = useMemo(() => {
    if (!scope || !listed.data || !children.data) return null;
    return withFamilyChildren(listed.data, children.data, perChildScope);
  }, [scope, perChildScope, listed.data, children.data]);
  const loadError = listed.error ?? children.error ?? settingsLoad;
  const invalidate = useInvalidateFamily();
  // A changed number shows in the list and on the family's page.
  const reload = useCallback(
    () => invalidate(traegerBillingKeys.familiesFamily),
    [invalidate],
  );

  const open = useCallback(
    (family: BillingFamily) => router.push(familyHref(family)),
    [router],
  );
  const columns = useMemo(
    () =>
      familyColumns(
        { onChange: setChanging, paymentFilter },
        scope === "child",
      ),
    [scope, paymentFilter],
  );
  const shown =
    families?.filter(
      (family) =>
        familyMatches(family, search) &&
        matchesOpenFilter(family, openFilter) &&
        matchesNumberFilter(family, numberFilter) &&
        matchesPaymentFilter(family, paymentFilter),
    ) ?? [];
  const withOpen = families?.filter((family) => family.openCents > 0).length;
  const withoutNumber = families?.filter(lacksNumber).length;
  const filtered =
    search.trim() !== "" ||
    openFilter !== "" ||
    numberFilter !== "" ||
    paymentFilter !== "";

  const filters: FilterConfig[] = [
    {
      id: "open",
      label: "Offene Forderung",
      type: "dropdown",
      value: openFilter,
      onChange: (value) => setOpenFilter(value as OpenFilter),
      options: [
        { value: "", label: "Alle Familien" },
        { value: "offen", label: OPEN_FILTER_LABELS.offen },
        { value: "ausgeglichen", label: OPEN_FILTER_LABELS.ausgeglichen },
      ],
    },
    {
      id: "number",
      label: "Debitorennummer",
      type: "dropdown",
      value: numberFilter,
      onChange: (value) => setNumberFilter(value as NumberFilter),
      options: [
        { value: "", label: "Alle Nummern" },
        { value: "ohne", label: NUMBER_FILTER_LABELS.ohne },
        { value: "mit", label: NUMBER_FILTER_LABELS.mit },
      ],
    },
    {
      id: "payment",
      label: "Zahlungsweg",
      type: "dropdown",
      value: paymentFilter,
      onChange: (value) =>
        setPaymentFilter(
          familyPaymentFilterOf(typeof value === "string" ? value : null),
        ),
      options: [
        { value: "", label: "Alle Zahlungswege" },
        { value: "ohne", label: PAYMENT_FILTER_LABELS.ohne },
        { value: "lastschrift", label: PAYMENT_FILTER_LABELS.lastschrift },
        { value: "ueberweisung", label: PAYMENT_FILTER_LABELS.ueberweisung },
      ],
    },
  ];
  const activeFilters: ActiveFilter[] = [
    ...(openFilter
      ? [
          {
            id: "open",
            label: OPEN_FILTER_LABELS[openFilter],
            onRemove: () => setOpenFilter(""),
          },
        ]
      : []),
    ...(numberFilter
      ? [
          {
            id: "number",
            label: NUMBER_FILTER_LABELS[numberFilter],
            onRemove: () => setNumberFilter(""),
          },
        ]
      : []),
    ...(paymentFilter
      ? [
          {
            id: "payment",
            label: PAYMENT_FILTER_LABELS[paymentFilter],
            onRemove: () => setPaymentFilter(""),
          },
        ]
      : []),
  ];
  const resetFilters = () => {
    setSearch("");
    setOpenFilter("");
    setNumberFilter("");
    setPaymentFilter("");
  };
  const emptySearch = emptySearchText(
    search,
    activeFilters.map((filter) => filter.label),
  );

  const exportItems = useTraegerListExportItems({
    download: (format) =>
      downloadTraegerList(
        bffFile("org", "GET /traeger/billing-families/export", {
          query: listExportQuery(format),
        }),
      ),
    scope:
      "Alle Familien, ohne Suche und Filter. Jeder Download wird protokolliert.",
    fallbackName: "familien",
    errorObject: "die Liste der Familien",
    unavailable: !families || families.length === 0,
  });
  return (
    <TenantPage
      title={billingAreaTitle("familien")}
      info={`Hier siehst du pro Familie alle Rechnungen, Stornos und Gutschriften und ${scope === "child" ? "die Debitorennummer jedes Kindes" : "ihre Debitorennummer"}. Eine Familie ist eine E-Mail-Adresse. Familien mit Vertrag stehen hier schon vor der ersten Rechnung, Familien aus der Ferienbetreuung nach dem Bestätigen der Anmeldung. Den Zahlungsweg einer Familie legst du über das Menü in ihrer Zeile fest, auch vor der ersten Rechnung. Die offene Forderung ist, was die Rechnungen nach Storno und Gutschrift noch verlangen. Zahlungen sieht moto nicht. Ob eine Familie schon gezahlt hat, prüfst du in deiner Buchhaltung. Alle Rechnungen in einer Liste findest du unter „Abrechnungsläufe“ im Reiter „Rechnungsausgangsbuch“.`}
      tabs={billingTabs("familien")}
      stats={
        families && families.length > 0 ? (
          <TenantPageStats
            items={[
              {
                value: families.length,
                label: families.length === 1 ? "Familie" : "Familien",
              },
              { value: withOpen ?? 0, label: "mit offener Forderung" },
              {
                value: withoutNumber ?? 0,
                label:
                  scope === "child"
                    ? "mit Kind ohne Nummer"
                    : "ohne Debitorennummer",
                // Ein Klick zeigt genau diese Familien (#6675).
                ...(withoutNumber && numberFilter !== "ohne"
                  ? {
                      onSelect: () => setNumberFilter("ohne"),
                      selectLabel: "Familien ohne Debitorennummer zeigen",
                    }
                  : {}),
              },
            ]}
          />
        ) : null
      }
      statsLoading={!families && !loadError}
      overflowMenu={[
        ...exportItems,
        { kind: "separator" },
        {
          // Geschwister ohne Mail-Adresse sind getrennte Familien, bis das
          // Büro sie zusammenführt (#7161).
          label: "Geschwister zusammenführen",
          description:
            "Öffnet die Familien ohne Mail-Adresse, um Geschwister zu einer Familie zusammenzuführen.",
          icon: <UsersRound className="h-4 w-4" aria-hidden />,
          href: traegerPath("/traeger/vertraege/geschwister"),
          onClick: () => undefined,
        },
      ]}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: "Name, E-Mail, Debitorennummer",
      }}
      filters={filters}
      activeFilters={activeFilters}
      onClearAllFilters={() => {
        setOpenFilter("");
        setNumberFilter("");
        setPaymentFilter("");
      }}
      error={loadError}
      // A list loads in the shape of its rows.
      loading={
        !loadError && !families ? (
          <ListSkeleton rows={6} avatar={false} />
        ) : (
          false
        )
      }
      overlays={
        <>
          <FamilyDebtorNumberModal
            family={changing && !perChild(changing) ? changing : null}
            format={format}
            onClose={() => setChanging(null)}
            onSaved={reload}
          />
          <ChildDebtorNumbersModal
            family={changing && perChild(changing) ? changing : null}
            format={format}
            onClose={() => setChanging(null)}
            onSaved={reload}
          />
        </>
      }
    >
      {families ? (
        <>
          {/* Die Summen folgen Suche und Filter; die erste Kachel sagt, für
              wen. Ohne Treffer steht die Meldung direkt unter der Suche. */}
          {filtered && shown.length === 0 ? null : (
            <BillingAmountCards
              amounts={sumAmounts(shown)}
              scope={
                filtered
                  ? `Rechnungen der ${shown.length} gefundenen ${shown.length === 1 ? "Familie" : "Familien"}.`
                  : undefined
              }
            />
          )}
          <DataTable
            columns={columns}
            rows={shown}
            getRowKey={(family) => family.familyEmail || family.id}
            defaultSortKey="family"
            // Seven columns with four sums: narrower cells keep the open
            // claim in view beside the family on a laptop and a tablet.
            dense
            stackedLayout="row"
            stackedDetailKey="debtor"
            rowHasInteractiveControls
            onRowClick={open}
            canClickRow={(family) => family.hasDocuments}
            emptyState={
              filtered ? (
                <EmptyState
                  title="Keine Familie passt zur Suche."
                  description={emptySearch.description}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      tooltip="Leert Suche und Filter und zeigt wieder alle Familien."
                      onClick={resetFilters}
                    >
                      {emptySearch.actionLabel}
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<MotoConceptIcon concept={parentsConcept} size={48} />}
                  title="Noch keine Familie."
                  description="Eine Familie steht hier, sobald sie einen Vertrag hat, du eine Ferienanmeldung bestätigst oder eine Rechnung freigibst."
                />
              )
            }
          />
        </>
      ) : null}
    </TenantPage>
  );
}
