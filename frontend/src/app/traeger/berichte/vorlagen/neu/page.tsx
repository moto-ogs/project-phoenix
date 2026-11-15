"use client";

// Neue Berichtsvorlage des Trägers (#4716). `?kopie=ID` füllt die Angaben
// einer vorhandenen Vorlage vor.

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  blankTemplateInput,
  ReportTemplateForm,
  templateInputOf,
} from "~/components/traeger/report-template-form";
import { useReportTemplates } from "~/components/traeger/use-report-templates";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { TenantPage } from "~/components/ui/tenant-page";
import { createReportTemplate } from "~/lib/traeger-reports-api";
import { traegerPath } from "~/lib/traeger-url";

export default function NewReportTemplatePage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense fallback={<TenantPage title="Neue Vorlage" loading />}>
      <NewReportTemplateContent />
    </Suspense>
  );
}

function NewReportTemplateContent() {
  const router = useRouter();
  const copyOf = useSearchParams().get("kopie");
  const { schools, error: schoolsError } = useTraegerSchools();
  const { templates, error: templatesError, mutate } = useReportTemplates();
  const listHref = traegerPath("/traeger/berichte");
  const source = copyOf
    ? templates?.find((template) => template.id === copyOf)
    : undefined;
  const error = schoolsError ?? templatesError;
  const ready = schools !== null && templates !== null;

  return (
    <TenantPage
      title="Neue Vorlage"
      info="Eine Vorlage merkt sich, welche Abschnitte ein Bericht hat, welcher Stichtag üblich ist und welche Schule zu welchem Sozialraum gehört."
      back
      backHref={listHref}
      backLabel="Zurück zu den Berichten"
      error={error}
      loading={!error && !ready}
    >
      {ready ? (
        <ReportTemplateForm
          initial={
            source
              ? { ...templateInputOf(source), name: `${source.name} (Kopie)` }
              : blankTemplateInput()
          }
          schools={schools}
          takenNames={templates.map((template) => template.name)}
          saveLabel="Vorlage anlegen"
          onSave={createReportTemplate}
          onCancel={() => router.push(listHref)}
          onSaved={(template) => {
            void mutate();
            router.replace(
              traegerPath(
                `/traeger/berichte?vorlage=${encodeURIComponent(template.id)}`,
              ),
            );
          }}
        />
      ) : null}
    </TenantPage>
  );
}
