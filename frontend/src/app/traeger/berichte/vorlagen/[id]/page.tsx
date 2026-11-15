"use client";

// Eine Berichtsvorlage des Trägers ändern (#4716).

import { useParams, useRouter } from "next/navigation";
import {
  ReportTemplateForm,
  templateInputOf,
} from "~/components/traeger/report-template-form";
import { useReportTemplates } from "~/components/traeger/use-report-templates";
import { useTraegerSchools } from "~/components/traeger/use-traeger-schools";
import { TenantPage } from "~/components/ui/tenant-page";
import { updateReportTemplate } from "~/lib/traeger-reports-api";
import { traegerPath } from "~/lib/traeger-url";

export default function EditReportTemplatePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { schools, error: schoolsError } = useTraegerSchools();
  const { templates, error: templatesError, mutate } = useReportTemplates();
  const listHref = traegerPath("/traeger/berichte");
  const template = templates?.find((entry) => entry.id === id) ?? null;
  const error = schoolsError ?? templatesError;
  const ready = schools !== null && templates !== null;

  return (
    <TenantPage
      title={template?.name ?? "Vorlage"}
      info="Änderungen gelten für jeden Bericht, den Sie danach mit dieser Vorlage erstellen."
      back
      backHref={listHref}
      backLabel="Zurück zu den Berichten"
      error={error}
      loading={!error && !ready}
      empty={
        ready && !template
          ? {
              title: "Vorlage nicht gefunden",
              description:
                "Vielleicht hat jemand sie gelöscht. Unter „Berichte“ stehen alle Vorlagen Ihres Trägers.",
            }
          : null
      }
    >
      {ready && template ? (
        <ReportTemplateForm
          key={template.id}
          initial={templateInputOf(template)}
          schools={schools}
          takenNames={templates
            .filter((entry) => entry.id !== template.id)
            .map((entry) => entry.name)}
          saveLabel="Speichern"
          onSave={(input) => updateReportTemplate(template.id, input)}
          onCancel={() => router.push(listHref)}
          onSaved={(saved) => {
            void mutate();
            router.push(
              traegerPath(
                `/traeger/berichte?vorlage=${encodeURIComponent(saved.id)}`,
              ),
            );
          }}
        />
      ) : null}
    </TenantPage>
  );
}
