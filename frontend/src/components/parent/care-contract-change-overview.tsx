"use client";

// Was sich mit der neuen Fassung eines Betreuungsvertrags ändert (#4816):
// je Wochentag die Betreuung bisher und neu. Die Karte ersetzt beim
// Unterschreiben einer geänderten Fassung die Liste „Gebuchte Betreuung“,
// damit Eltern die ganze Woche an einer Stelle lesen und die Änderung
// nicht selbst suchen müssen.

import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { SectionCard } from "~/components/ui/section-card";
import {
  StatusBadge,
  type StatusBadgeTone,
} from "~/components/ui/status-badge";
import {
  careChanges,
  type DayChange,
  type DayChangeKind,
} from "~/lib/care-contract-change";
import type {
  SigningService,
  SigningVersionFacts,
} from "~/lib/care-contract-signing-api";
import { changeHistoryConcept } from "~/lib/concepts/changeHistory";
import { formatDate } from "~/lib/date-helpers";

const KIND_TONES: Record<Exclude<DayChangeKind, "same">, StatusBadgeTone> = {
  added: "green",
  dropped: "gray",
  changed: "orange",
};

const KIND_LABELS = {
  added: "dayAdded",
  dropped: "dayDropped",
  changed: "dayChanged",
} as const;

function CareOfDay({ care }: Readonly<{ care: readonly SigningService[] }>) {
  const t = useTranslations("careContractSigning");
  const locale = useLocale();
  if (care.length === 0) return <span>{t("noCare")}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {care.map((service) => (
        <span key={`${service.moduleName}-${service.endsAt}`}>
          {service.moduleName}
          {service.endsAt ? ` · ${t("until", { time: service.endsAt })}` : null}
          {service.lastDay
            ? ` · ${t("bookedUntil", { date: formatDate(service.lastDay, false, locale) })}`
            : null}
        </span>
      ))}
    </span>
  );
}

function ChangedDay({ day }: Readonly<{ day: DayChange<SigningService> }>) {
  const t = useTranslations("careContractSigning");
  return (
    <span className="grid min-w-0 flex-1 grid-cols-1 gap-x-3 gap-y-1 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-baseline">
      <span className="text-gray-500">
        <span className="mr-1.5 text-xs font-semibold sm:sr-only">
          {t("before")}:
        </span>
        <span className="inline-flex line-through decoration-gray-400">
          <CareOfDay care={day.before} />
        </span>
      </span>
      <ArrowRight
        className="hidden h-4 w-4 self-center text-gray-500 sm:block"
        aria-hidden="true"
      />
      <span className="font-semibold text-gray-900">
        <span className="mr-1.5 text-xs font-semibold text-gray-500 sm:sr-only">
          {t("after")}:
        </span>
        <span className="inline-flex">
          <CareOfDay care={day.after} />
        </span>
      </span>
    </span>
  );
}

export function ContractChangeOverview({
  previous,
  services,
  effectiveFrom,
}: Readonly<{
  previous: SigningVersionFacts;
  services: readonly SigningService[];
  /** The day the new version holds from ("YYYY-MM-DD"). */
  effectiveFrom: string;
}>) {
  const t = useTranslations("careContractSigning");
  const locale = useLocale();
  const days = careChanges(previous.services, services);
  const changed = days.filter((day) => day.kind !== "same").length;
  return (
    <SectionCard
      concept={changeHistoryConcept}
      title={t("changesTitle")}
      description={t("changesDescription")}
      titleBadge={
        <StatusBadge
          label={
            changed === 0
              ? t("noDayChanges")
              : t("changedDays", { count: changed })
          }
          tone={changed === 0 ? "gray" : "orange"}
        />
      }
    >
      {/* The columns name themselves from sm on; on a phone every changed
          day carries „Bisher“ and „Neu“ in front of its two lines. */}
      {changed > 0 ? (
        <div
          aria-hidden="true"
          className="mb-2 hidden gap-4 border-b border-gray-100 pb-2 text-sm font-semibold text-gray-600 sm:flex"
        >
          <span className="w-28 shrink-0" />
          <span className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] gap-x-3">
            <span>{t("before")}</span>
            <span className="w-4" />
            <span>
              {t("afterFrom", {
                date: formatDate(effectiveFrom, false, locale),
              })}
            </span>
          </span>
          <span className="w-24 shrink-0" />
        </div>
      ) : null}
      <ul className="divide-y divide-gray-100">
        {days.map((day) => (
          <li
            key={day.weekday}
            className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4"
          >
            <span className="flex w-28 shrink-0 items-center justify-between gap-2 text-sm font-semibold text-gray-900 max-sm:w-full">
              {t(`weekdays.${day.weekday}`)}
              {day.kind === "same" ? null : (
                <span className="sm:hidden">
                  <StatusBadge
                    label={t(KIND_LABELS[day.kind])}
                    tone={KIND_TONES[day.kind]}
                    size="xs"
                  />
                </span>
              )}
            </span>
            {day.kind === "same" ? (
              <span className="min-w-0 flex-1 text-sm text-gray-600">
                <CareOfDay care={day.after} />
              </span>
            ) : (
              <>
                <ChangedDay day={day} />
                <span className="hidden w-24 shrink-0 justify-end sm:flex">
                  <StatusBadge
                    label={t(KIND_LABELS[day.kind])}
                    tone={KIND_TONES[day.kind]}
                    size="xs"
                  />
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
