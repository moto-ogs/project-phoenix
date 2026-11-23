"use client";

import { useCallback, useState } from "react";

import { Button } from "~/components/ui/button";
import { Modal } from "~/components/ui/modal";
import { fetchSurveyForm, submitSurveyAnswers } from "~/lib/surveys-api";
import type * as surveysContract from "~/lib/contract/surveys.generated";
import { SurveyAnswerPanel } from "./survey-questionnaire";

/**
 * Eine Umfrage an das Team beantworten (#4781). Der Fragebogen ist derselbe
 * wie im Elternportal; der Hinweis, ob die Umfrage anonym ist, steht vor der
 * ersten Frage.
 */
export function SurveyAnswerModal({
  survey,
  onClose,
  onSubmitted,
}: Readonly<{
  survey: surveysContract.surveyToAnswerResponse;
  onClose: () => void;
  onSubmitted: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetchSurveyForm(survey.id), [survey.id]);
  const submit = useCallback(
    (body: Parameters<typeof submitSurveyAnswers>[1]) =>
      submitSurveyAnswers(survey.id, body),
    [survey.id],
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={survey.title}
      isDismissDisabled={busy}
      isBackdropDismissDisabled
      size="lg"
      footer={
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={onClose}
          disabled={busy}
          tooltip="Schließt die Umfrage, nicht abgesendete Antworten gehen verloren."
        >
          Schließen
        </Button>
      }
    >
      <SurveyAnswerPanel
        load={load}
        submit={submit}
        respondent="staff"
        formId={survey.id}
        onBusyChange={setBusy}
        onSubmitted={onSubmitted}
      />
    </Modal>
  );
}
