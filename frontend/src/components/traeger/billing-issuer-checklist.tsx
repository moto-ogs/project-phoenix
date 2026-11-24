"use client";

// Was eine Stelle noch braucht, die Schulen selbst abrechnet (#8040, ADR
// 0321): Anschrift, Gläubiger-ID und Konto hat sie schon, sonst rechnete
// noch der Träger ab. Fehlen können Nummernkreise, die Belehrung eines
// Bescheids und die Mandate der Familien, die per Lastschrift zahlen. Jede
// Zeile sagt, was zu tun ist, und führt dorthin.

import { ButtonLink } from "~/components/ui/button";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { FramedList } from "~/components/ui/framed-list";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import {
  type BillingIssuerStatus,
  fetchBillingIssuerStatuses,
} from "~/lib/traeger-billing-issuers-api";
import { traegerPath } from "~/lib/traeger-url";
import { useTraegerResource } from "./use-traeger-resource";

const NUMBER_RANGES_PATH = "/traeger/einstellungen/abrechnung";
const DOCUMENT_KINDS_PATH = "/traeger/einstellungen/dokumentarten";
const MANDATES_PATH = "/traeger/abrechnung/lastschrift";

const KIND_LABEL = {
  confirmation: "Bestätigung und Rechnung",
  invoice: "Rechnung",
  fee_notice: "Gebührenbescheid",
} as const;

interface CheckRow {
  readonly key: string;
  readonly label: string;
  readonly text: string;
  readonly done: boolean;
  readonly action?: {
    readonly href: string;
    readonly label: string;
    readonly tooltip: string;
  };
}

function rowsOf(status: BillingIssuerStatus): CheckRow[] {
  const name = status.issuer.name;
  const ranges = status.services.filter((service) => !service.pattern);
  const kinds = status.services.flatMap((service) =>
    service.documentKind ? [KIND_LABEL[service.documentKind]] : [],
  );
  const missing = status.familiesWithoutMandate;
  return [
    status.creditorIsTraegers
      ? {
          key: "master",
          label: "Anschrift, Gläubiger-ID und Konto",
          text: `${name} trägt die Gläubiger-ID deines Trägers. Jede Stelle braucht ihre eigene. Bis dahin gibt moto keinen Lauf frei.`,
          done: false,
          action: {
            href: `/traeger/schulen/${status.schoolIds[0] ?? ""}?bereich=zustaendigkeiten`,
            label: "Gläubiger-ID ändern",
            tooltip: `Öffnet die Angaben von ${name} bei der Schule.`,
          },
        }
      : {
          key: "master",
          label: "Anschrift, Gläubiger-ID und Konto",
          text: `Stehen in den Schreiben von ${name}. Die Lastschrift zieht auf dieses Konto ein.`,
          done: true,
        },
    {
      key: "ranges",
      label: "Nummernkreise",
      text:
        ranges.length === 0
          ? "Ferien und Monatsbeiträge haben eigene Nummern."
          : `Es fehlt das Muster für ${ranges
              .map((service) =>
                service.service === "holiday"
                  ? "die Ferien"
                  : "die Monatsbeiträge",
              )
              .join(" und ")}. Ohne Muster gibt moto keinen Lauf frei.`,
      done: ranges.length === 0,
      action:
        ranges.length === 0
          ? undefined
          : {
              href: NUMBER_RANGES_PATH,
              label: "Muster festlegen",
              tooltip: `Öffnet die Abrechnungsvorgaben mit den Nummernkreisen von ${name}.`,
            },
    },
    {
      key: "kinds",
      label: "Dokumentart",
      text: status.legalRemedyMissing
        ? "Ein Gebührenbescheid braucht die Rechtsbehelfsbelehrung. Sie fehlt noch in der Vorlage „Bescheid“."
        : `${[...new Set(kinds)].join(", ")}.`,
      done: !status.legalRemedyMissing,
      action: {
        href: DOCUMENT_KINDS_PATH,
        label: status.legalRemedyMissing ? "Dokumentart prüfen" : "Ändern",
        tooltip: `Öffnet die Dokumentarten von ${name}.`,
      },
    },
    {
      key: "mandates",
      label: "Mandate der Familien",
      text:
        status.directDebitFamilies === 0
          ? "Keine Familie zahlt die Monatsbeiträge hier per Lastschrift."
          : missing === 0
            ? `Alle ${status.directDebitFamilies} Familien mit Lastschrift für die Monatsbeiträge haben ein gültiges Mandat für ${name}.`
            : `${missing} von ${status.directDebitFamilies} Familien mit Lastschrift für die Monatsbeiträge brauchen ein neues Mandat für ${name}. Ein Mandat für deinen Träger gilt nicht für ${name}.`,
      done: missing === 0,
      action:
        missing === 0
          ? undefined
          : {
              href: MANDATES_PATH,
              label: "Mandate ansehen",
              tooltip:
                "Öffnet die Lastschriften mit den Mandaten der Familien.",
            },
    },
  ];
}

function BillingIssuerChecklist({
  status,
  schoolNames,
}: Readonly<{
  status: BillingIssuerStatus;
  /** The schools the body bills, by name. */
  schoolNames: readonly string[];
}>) {
  const rows = rowsOf(status);
  const open = rows.filter((row) => !row.done).length;
  return (
    <SectionCard
      title={`Abrechnung durch ${status.issuer.name}`}
      description={`${status.issuer.name} stellt die Rechnungen und Bescheide für ${schoolNames.join(", ")} aus. Schon ausgestellte Schreiben bleiben, wie sie sind.`}
      action={
        open === 0 ? (
          <StatusBadge tone="green" label="Alles da" />
        ) : (
          <StatusBadge tone="warning" label={`${open} offen`} />
        )
      }
    >
      <FramedList>
        {rows.map((row) => (
          <li
            key={row.key}
            className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-4 py-3"
          >
            <div className="min-w-48 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">
                {row.label}
                <StatusBadge
                  tone={row.done ? "green" : "warning"}
                  size="xs"
                  label={row.done ? "Erledigt" : "Fehlt"}
                />
              </p>
              <p className="mt-0.5 text-sm text-gray-600">{row.text}</p>
            </div>
            {row.action ? (
              <ButtonLink
                href={traegerPath(row.action.href)}
                variant="surface"
                size="compact"
                tooltip={row.action.tooltip}
              >
                {row.action.label}
              </ButtonLink>
            ) : null}
          </li>
        ))}
      </FramedList>
    </SectionCard>
  );
}

/**
 * The checklist of every body that bills a school itself, or only of the
 * body of one school. Without such a body it shows nothing: the Träger's
 * own details stand in its settings.
 */
export function BillingIssuerChecklists({
  schools,
  schoolId,
}: Readonly<{
  schools: readonly {
    readonly schoolId: string;
    readonly schoolName: string;
  }[];
  /** Only the body that bills this school. */
  schoolId?: string;
}>) {
  const statuses = useTraegerResource(
    traegerKeys.billingIssuers(),
    fetchBillingIssuerStatuses,
    "den Stand der Stellen, die selbst abrechnen",
  );
  if (statuses.error) return <LoadErrorAlert error={statuses.error} />;
  const shown = (statuses.data ?? []).filter(
    (status) => !schoolId || status.schoolIds.includes(schoolId),
  );
  return (
    <>
      {shown.map((status) => (
        <BillingIssuerChecklist
          key={status.issuer.key}
          status={status}
          schoolNames={status.schoolIds.map(
            (id) =>
              schools.find((school) => school.schoolId === id)?.schoolName ??
              "eine Schule",
          )}
        />
      ))}
    </>
  );
}
