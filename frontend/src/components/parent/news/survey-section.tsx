"use client";

/**
 * Eine Umfrage mit Fragebogen im Elternbrief-Dialog (#4781). Eltern antworten
 * einmal je Elternkonto, nicht je Kind. Ob die Umfrage anonym ist, steht vor
 * der ersten Frage.
 */

import { useCallback } from "react";

import { SurveyAnswerPanel } from "~/components/surveys/survey-questionnaire";
import { SectionCard } from "~/components/ui/section-card";
import {
  fetchParentSurveyForm,
  submitParentSurveyAnswers,
} from "~/lib/parent-api";
import type { SurveyAnswersRequest } from "~/lib/survey-form";
import type * as parentMeContract from "~/lib/contract/parent-me.generated";

export function isSurveyItem(
  item: parentMeContract.AnnouncementResponse,
): item is parentMeContract.AnnouncementResponse & {
  survey: parentMeContract.AnnouncementSurveyResponse;
} {
  return item.system_kind === "survey" && item.survey !== undefined;
}

/** Noch offen und von diesem Elternkonto noch nicht beantwortet. */
export function isOpenSurvey(
  item: parentMeContract.AnnouncementResponse,
): boolean {
  if (!isSurveyItem(item)) return false;
  return (
    !item.survey.participated && new Date(item.survey.closes_at) > new Date()
  );
}

export function ParentSurveySection({
  item,
  onUpdated,
  onBusyChange,
}: Readonly<{
  item: parentMeContract.AnnouncementResponse & {
    survey: parentMeContract.AnnouncementSurveyResponse;
  };
  onUpdated: (
    id: string,
    patch: Partial<parentMeContract.AnnouncementResponse>,
  ) => void;
  onBusyChange: (busy: boolean) => void;
}>) {
  const announcementId = item.id;
  const survey = item.survey;
  const load = useCallback(
    () => fetchParentSurveyForm(announcementId),
    [announcementId],
  );
  const submit = useCallback(
    (body: SurveyAnswersRequest) =>
      submitParentSurveyAnswers(announcementId, body),
    [announcementId],
  );
  const handleSubmitted = useCallback(() => {
    onUpdated(announcementId, {
      read: true,
      survey: { ...survey, participated: true },
    });
    window.dispatchEvent(new Event("parent-news-unread-refresh"));
  }, [announcementId, onUpdated, survey]);

  return (
    <SectionCard>
      <SurveyAnswerPanel
        load={load}
        submit={submit}
        respondent="parent"
        formId={announcementId}
        formVersion={item.published_at ?? ""}
        showIntro={false}
        onBusyChange={onBusyChange}
        onSubmitted={handleSubmitted}
      />
    </SectionCard>
  );
}
