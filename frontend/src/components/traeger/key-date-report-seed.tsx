"use client";

import type { ReactNode } from "react";
import { latestKeyDate } from "./key-date-report-model";
import { useBerlinToday } from "~/lib/hooks/use-berlin-today";
import { SWRServerSeed, type ServerSeedInput } from "~/lib/swr/server-seed";
import { traegerKeys } from "~/lib/swr/traeger-keys";
import { traegerReportKeys } from "~/lib/swr/traeger-report-keys";
import type { ReportTemplate } from "~/lib/traeger-reports-api";

export function KeyDateReportSeed({
  seed,
  claims,
  templateId,
  keyDate,
  children,
}: Readonly<{
  seed: ServerSeedInput;
  claims: readonly string[];
  templateId: string;
  keyDate: string | null;
  children: ReactNode;
}>) {
  const today = useBerlinToday();
  return (
    <SWRServerSeed
      seed={seed}
      claims={claims}
      claimsFrom={{
        key: traegerKeys.reportTemplates(),
        derive: (templates: readonly ReportTemplate[]) => {
          const template = templates.find(({ id }) => id === templateId);
          const shown =
            keyDate ??
            latestKeyDate(today, template?.keyDateMonth, template?.keyDateDay);
          return [traegerReportKeys.keyDateReport(shown, template?.id ?? null)];
        },
      }}
      render
    >
      {children}
    </SWRServerSeed>
  );
}
