import { Suspense } from "react";
import { KeyDateReportSeed } from "~/components/traeger/key-date-report-seed";
import { latestKeyDate } from "~/components/traeger/key-date-report-model";
import { berlinTodayISO } from "~/lib/date-helpers";
import {
  keyDateReport,
  reportTemplates,
} from "~/lib/traeger/metrics-seed-reads.server";
import { traegerPageSeed } from "~/lib/traeger/page-seed.server";
import TraegerReportsPage from "./page-content";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    vorlage?: string | string[];
    stichtag?: string | string[];
  }>;
}) {
  const { vorlage, stichtag } = await searchParams;
  const templateId =
    (Array.isArray(vorlage) ? vorlage[0] : vorlage) ?? "standard";
  const rawDate = Array.isArray(stichtag) ? stichtag[0] : stichtag;
  const keyDate =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const today = berlinTodayISO();
  const { seed, claims } =
    templateId === "standard"
      ? traegerPageSeed([
          reportTemplates,
          keyDateReport(keyDate ?? latestKeyDate(today), null),
        ])
      : traegerPageSeed([reportTemplates], async (token) => {
          const templates = await reportTemplates.load(token);
          if (!templates) return [];
          const template = templates.find(({ id }) => id === templateId);
          const date =
            keyDate ??
            latestKeyDate(today, template?.keyDateMonth, template?.keyDateDay);
          return [keyDateReport(date, template?.id ?? null)];
        });

  return (
    <Suspense fallback={null}>
      <KeyDateReportSeed
        seed={seed}
        claims={claims}
        templateId={templateId}
        keyDate={keyDate}
      >
        <TraegerReportsPage />
      </KeyDateReportSeed>
    </Suspense>
  );
}
