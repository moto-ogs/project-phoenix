"use client";

// Ansicht einer Schule im Träger-Portal (#5686): Zahlen von jetzt und
// Stammdaten, ohne die Träger-Navigation zu verlassen. Nur Zahlen, keine Namen.
// Die Schul-App öffnet sich als eigene Aktion in einem neuen Tab. Der Reiter
// „Zuständigkeiten“ (#4811) zeigt, wer an der Schule Verträge schließt,
// abrechnet und Personal anstellt, mit den Angaben zu Schulträger und
// Gemeinde.

import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { SchoolResponsibilityTab } from "~/components/traeger/school-responsibility-tab";
import { useTraegerResponsibilities } from "~/components/traeger/use-traeger-responsibilities";
import { Loading } from "~/components/ui/loading";
import { LoadErrorAlert } from "~/components/ui/form-error-alert";
import { EmptyState } from "~/components/ui/empty-state";
import {
  SCHOOL_SWITCH_MISSING_HINT,
  useOpenTraegerSchool,
} from "~/components/traeger/use-open-traeger-school";
import { TraegerCodeStepModal } from "~/components/traeger/traeger-code-step-modal";
import { TraegerOpenSchoolButton } from "~/components/traeger/traeger-open-school-button";
import { useTraegerSchool } from "~/components/traeger/use-traeger-school";
import { DataField, DataGrid } from "~/components/ui/data-field";
import { SectionCard } from "~/components/ui/section-card";
import { StatCard } from "~/components/ui/stat-card";
import { TenantPage } from "~/components/ui/tenant-page";
import { formatBerlinTime } from "~/lib/date-helpers";
import { MotoConceptIcon } from "~/components/ui/moto-concept-icon";
import { childrenConcept } from "~/lib/concepts/children";
import { presentConcept } from "~/lib/concepts/present";
import { schoolsConcept } from "~/lib/concepts/schools";
import { sickConcept } from "~/lib/concepts/sick";
import { staffConcept } from "~/lib/concepts/staff";
import { supervisionConcept } from "~/lib/concepts/supervision";
import type { TraegerSchoolView } from "~/lib/traeger-api";
import { traegerPath } from "~/lib/traeger-url";
import { ConceptIconTile } from "~/components/ui/concept-icon-tile";

type SchoolTab = "uebersicht" | "stammdaten" | "zustaendigkeiten";

const SCHOOL_TABS = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "stammdaten", label: "Stammdaten" },
  { value: "zustaendigkeiten", label: "Zuständigkeiten" },
] as const;

/** Opens a tab by its key, e.g. `?bereich=zustaendigkeiten` from the settings. */
const TAB_PARAM = "bereich";

function initialTab(value: string | null | undefined): SchoolTab {
  return SCHOOL_TABS.find((tab) => tab.value === value)?.value ?? "uebersicht";
}

const EMPTY_VALUE = "–";

const ratioFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
});

function OverviewTab({
  figures,
}: Readonly<{ figures: TraegerSchoolView["figures"] | null }>) {
  const loading = figures === null;
  const ratio = figures?.careRatio ?? null;
  return (
    // Wie auf dem Dashboard: oben die Kinder in drei Spalten, darunter das
    // Personal in zwei breiteren, damit lange Labels neben dem Symbol in
    // einer Zeile bleiben.
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
      <div className="lg:col-span-2">
        <StatCard
          label="Kinder gesamt"
          value={figures?.childrenTotal ?? 0}
          hint="Alle betreuten Kinder dieser Schule."
          icon={<MotoConceptIcon concept={childrenConcept} />}
          loading={loading}
          tone="neutral"
        />
      </div>
      <div className="lg:col-span-2">
        <StatCard
          label="Jetzt anwesend"
          value={figures?.childrenPresent ?? 0}
          hint="Kinder, die gerade in der Schule sind."
          icon={<MotoConceptIcon concept={presentConcept} />}
          loading={loading}
          tone={(figures?.childrenPresent ?? 0) > 0 ? "green" : "neutral"}
        />
      </div>
      <div className="lg:col-span-2">
        <StatCard
          label="Heute krank"
          value={figures?.childrenSick ?? 0}
          hint="Kinder mit Krankmeldung für heute."
          icon={<MotoConceptIcon concept={sickConcept} />}
          loading={loading}
          tone={(figures?.childrenSick ?? 0) > 0 ? "orange" : "neutral"}
        />
      </div>
      <div className="lg:col-span-3">
        <StatCard
          label="Betreuungskräfte anwesend"
          value={figures?.staffPresent ?? 0}
          hint="Angemeldet in der Zeiterfassung. Homeoffice zählt nicht."
          icon={<MotoConceptIcon concept={staffConcept} />}
          loading={loading}
          tone="neutral"
        />
      </div>
      <div className="lg:col-span-3">
        <StatCard
          label="Betreuungsschlüssel"
          value={
            ratio === null ? EMPTY_VALUE : `1 : ${ratioFormat.format(ratio)}`
          }
          hint={
            ratio === null
              ? "Gerade ist keine Betreuungskraft in der Zeiterfassung angemeldet."
              : "Anwesende Kinder je anwesender Betreuungskraft."
          }
          icon={<MotoConceptIcon concept={supervisionConcept} />}
          loading={loading}
          tone="neutral"
        />
      </div>
    </div>
  );
}

function MasterDataTab({
  school,
}: Readonly<{ school: TraegerSchoolView | null }>) {
  const place = [school?.zip, school?.city].filter(Boolean).join(" ");
  return (
    <>
      <SectionCard
        leading={<ConceptIconTile concept={schoolsConcept} />}
        title="Anschrift und Kontakt"
        description="Nur zum Lesen. Änderungen übernimmt das moto-Team."
        loading={school === null}
      >
        <DataGrid columns={2}>
          <DataField label="Name">{school?.name ?? EMPTY_VALUE}</DataField>
          <DataField label="Anschrift">
            {school?.address || place ? (
              <>
                {school?.address}
                {school?.address && place ? <br /> : null}
                {place}
              </>
            ) : (
              EMPTY_VALUE
            )}
          </DataField>
          <DataField label="Telefon">{school?.phone || EMPTY_VALUE}</DataField>
          <DataField label="E-Mail">{school?.email || EMPTY_VALUE}</DataField>
        </DataGrid>
      </SectionCard>
      <SectionCard
        title="Größe der Schule"
        description="Alle Kinder, die die Schule gerade betreut, und alle Betreuungskräfte ohne externe Kräfte."
        loading={school === null}
      >
        <DataGrid columns={2}>
          <DataField label="Kinder">
            {school?.figures.childrenTotal ?? EMPTY_VALUE}
          </DataField>
          <DataField label="Betreuungskräfte">
            {school?.figures.staffTotal ?? EMPTY_VALUE}
          </DataField>
        </DataGrid>
      </SectionCard>
    </>
  );
}

/**
 * Who is responsible at the school, read when the tab opens: the read
 * shows bank accounts and stands in the Träger's log.
 */
function ResponsibilityTab({ schoolId }: Readonly<{ schoolId: string }>) {
  const { data, loading, error, reloadOrThrow } = useTraegerResponsibilities();
  const school = data?.find((entry) => entry.schoolId === schoolId);
  if (error) return <LoadErrorAlert error={error} />;
  if (loading || !data) return <Loading />;
  if (!school) {
    return (
      <EmptyState
        variant="compact"
        title="Für diese Schule gibt es keine Zuständigkeiten"
        description="Die Schule gehört nicht mehr zu deinem Träger."
      />
    );
  }
  return <SchoolResponsibilityTab school={school} reload={reloadOrThrow} />;
}

export default function TraegerSchoolPage() {
  // `useSearchParams` braucht eine Suspense-Grenze; bis dahin lädt die Seite.
  return (
    <Suspense fallback={<TenantPage title="Schule" loading />}>
      <TraegerSchoolContent />
    </Suspense>
  );
}

function TraegerSchoolContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { school, error } = useTraegerSchool(params?.id ?? "");
  const { canOpen, opening, open, codeStepModal } = useOpenTraegerSchool();
  const [tab, setTab] = useState<SchoolTab>(() =>
    initialTab(searchParams?.get(TAB_PARAM)),
  );

  return (
    <TenantPage
      title={school?.name ?? "Schule"}
      leading={<ConceptIconTile concept={schoolsConcept} size="page" />}
      back
      backHref={traegerPath("/traeger")}
      backLabel="Zurück zu den Schulen"
      info={
        <>
          Zahlen, Stammdaten und Zuständigkeiten dieser Schule. moto zeigt hier
          keine Namen von Kindern oder Personal. Die Zahlen aktualisieren sich
          jede Minute.
          {!canOpen && ` ${SCHOOL_SWITCH_MISSING_HINT}`}
        </>
      }
      stats={
        school ? `Stand ${formatBerlinTime(school.figures.asOf)} Uhr` : null
      }
      statsLoading={school === null && !error}
      error={error}
      actions={
        canOpen && school ? (
          <TraegerOpenSchoolButton
            school={school}
            opening={opening}
            size="md"
            onOpen={() => void open(school)}
          />
        ) : null
      }
      tabs={{
        value: tab,
        onChange: (value) => setTab(value as SchoolTab),
        items: SCHOOL_TABS,
        label: "Bereiche der Schule",
      }}
    >
      {tab === "uebersicht" ? (
        <OverviewTab figures={school?.figures ?? null} />
      ) : null}
      {tab === "stammdaten" ? <MasterDataTab school={school} /> : null}
      {tab === "zustaendigkeiten" ? (
        <ResponsibilityTab schoolId={params?.id ?? ""} />
      ) : null}
      <TraegerCodeStepModal {...codeStepModal} />
    </TenantPage>
  );
}
