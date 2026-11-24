"use client";

// Die Lohnwerte der Arbeitgeber neben dem Träger (#8041, ADR 0320): je
// Schule, an der eine Gemeinde oder ein Schulträger das Personal anstellt,
// die Berater- und Mandantennummer ihrer eigenen Datei und die Kostenstelle
// ihrer Zeilen in der einen Datei des Trägers. Welche Werte gebraucht
// werden, hängt von der gewählten Form ab; die Spalte „Stand“ sagt es je
// Zeile.

import { ButtonLink } from "~/components/ui/button";
import { DataTable, type DataTableColumn } from "~/components/ui/data-table";
import { EmptyState } from "~/components/ui/empty-state";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import type { FormErrorInput } from "~/components/ui/form-error";
import { Input } from "~/components/ui/input";
import { SectionCard } from "~/components/ui/section-card";
import { StatusBadge } from "~/components/ui/status-badge";
import { schoolsConcept } from "~/lib/concepts/schools";
import {
  EMPLOYER_BODY_LABELS,
  type PayrollEmployer,
  type PayrollEmployerValues,
  type PayrollForm,
} from "~/lib/traeger-staff-exports-api";
import { traegerPath } from "~/lib/traeger-url";

const RESPONSIBILITIES_PATH = "/traeger/einstellungen/zustaendigkeiten";

/** Was einem Arbeitgeber für die gewählte Form noch fehlt. */
export function employerGap(
  form: PayrollForm,
  values: PayrollEmployerValues,
): string | null {
  if (form === "traeger") {
    return values.costCenter === "" ? "Kostenstelle fehlt" : null;
  }
  if (values.consultantNumber === "" || values.clientNumber === "") {
    return "Berater- und Mandantennummer fehlen";
  }
  return null;
}

/** Der Arbeitgeber, wie die Seite ihn nennt: „Gemeinde Hardt“. */
export const employerLabel = (employer: {
  readonly body: keyof typeof EMPLOYER_BODY_LABELS;
  readonly name: string;
}) => employer.name || EMPLOYER_BODY_LABELS[employer.body];

/** Der Schlüssel eines Feldes einer Zeile für Entwurf und Feldfehler. */
export const employerFieldKey = (
  schoolId: string,
  field: keyof PayrollEmployerValues,
) => `employer.${schoolId}.${field}`;

const FIELDS: readonly {
  readonly field: keyof PayrollEmployerValues;
  readonly header: string;
  readonly maxLength: number;
}[] = [
  { field: "consultantNumber", header: "Beraternummer", maxLength: 7 },
  { field: "clientNumber", header: "Mandantennummer", maxLength: 5 },
  { field: "costCenter", header: "Kostenstelle", maxLength: 8 },
];

export function PayrollEmployersCard({
  employers,
  loadError,
  form,
  valuesOf,
  writable,
  fieldError,
  onChange,
}: Readonly<{
  employers: readonly PayrollEmployer[] | undefined;
  loadError: FormErrorInput;
  form: PayrollForm;
  valuesOf: (employer: PayrollEmployer) => PayrollEmployerValues;
  writable: boolean;
  fieldError: (key: string) => string | null;
  onChange: (
    employer: PayrollEmployer,
    field: keyof PayrollEmployerValues,
    value: string,
  ) => void;
}>) {
  const description =
    form === "traeger"
      ? "In der einen Datei braucht jeder dieser Arbeitgeber eine Kostenstelle. Daran erkennt dein Lohnbüro seine Stunden."
      : "Jeder dieser Arbeitgeber bekommt eine eigene Datei. Dafür braucht er seine Berater- und Mandantennummer.";
  const responsibilitiesLink = (
    <ButtonLink
      href={traegerPath(RESPONSIBILITIES_PATH)}
      variant="surface"
      size="compact"
      tooltip="Öffnet die Zuständigkeiten. Dort legst du fest, wer an einer Schule anstellt."
    >
      Zuständigkeiten öffnen
    </ButtonLink>
  );

  const columns: DataTableColumn<PayrollEmployer>[] = [
    {
      key: "employer",
      header: "Arbeitgeber",
      stacked: "title",
      render: (employer) => (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-gray-900">
            {employerLabel(employer)}
          </span>
          <span className="text-sm text-gray-500">{employer.schoolName}</span>
        </span>
      ),
    },
    ...FIELDS.map(
      ({ field, header, maxLength }): DataTableColumn<PayrollEmployer> => ({
        key: field,
        header,
        stacked: "field",
        render: (employer) => {
          const key = employerFieldKey(employer.schoolId, field);
          return (
            <span className="block w-full md:w-28">
              <Input
                name={key}
                controlSize="compact"
                inputMode="numeric"
                maxLength={maxLength}
                placeholder="–"
                aria-label={`${header} von ${employerLabel(employer)} an ${employer.schoolName}`}
                value={valuesOf(employer)[field]}
                readOnly={!writable}
                error={fieldError(key) ?? undefined}
                className="tabular-nums"
                onChange={(event) =>
                  onChange(employer, field, event.target.value)
                }
              />
            </span>
          );
        },
      }),
    ),
    {
      key: "state",
      header: "Stand",
      stacked: "field",
      render: (employer) => {
        const gap = employerGap(form, valuesOf(employer));
        return gap ? (
          <StatusBadge label={gap} tone="warning" compact />
        ) : (
          <StatusBadge label="Vollständig" tone="green" compact />
        );
      },
    },
  ];

  return (
    <SectionCard
      concept={schoolsConcept}
      title="Andere Arbeitgeber"
      description={description}
      action={responsibilitiesLink}
      loading={employers === undefined && !loadError}
      bodyClassName="mt-4 space-y-4"
    >
      {loadError ? <LoadErrorAlert error={loadError} /> : null}
      {employers && employers.length === 0 ? (
        <EmptyState
          variant="compact"
          title="An allen Schulen stellt der Träger das Personal an."
          description="Stellt an einer Schule eine Gemeinde oder ein Schulträger an, legst du das unter „Zuständigkeiten“ fest. Dann steht der Arbeitgeber hier."
        />
      ) : null}
      {employers && employers.length > 0 ? (
        <DataTable
          columns={columns}
          rows={[...employers]}
          getRowKey={(employer) => `${employer.schoolId}-${employer.body}`}
          stackedLayout="form"
        />
      ) : null}
    </SectionCard>
  );
}
