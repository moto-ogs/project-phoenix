/**
 * Client des Mitarbeiterportals für Umfragen (#4781). Ruft die registrierten
 * Routen unter /api/surveys über bffJson (#7806). IDs kommen schon als
 * Strings.
 *
 * Schutzziel Anonymität: Antworten gehen nur im Rumpf von
 * `submitSurveyAnswers` hinaus. Kein Aufruf hier schreibt sie in eine
 * Adresse, und die Fehlermeldungen tragen nie Antwortinhalte.
 */

import { bffFile, bffJson } from "~/lib/bff-fetch";
import type * as surveysContract from "~/lib/contract/surveys.generated";
import { downloadBlob, filenameFromDisposition } from "~/lib/file-download";
import type { AnnouncementTarget } from "~/lib/parent-announcements-api";
import type {
  SurveyAnswersRequest,
  SurveyForm,
  SurveyQuestion,
  SurveyQuestionKind,
} from "~/lib/survey-form";

export type SurveyAudience = "parents" | "staff";
export type SurveyStatus = "draft" | "open" | "closed";

/** Dieselbe Form wie die Zielgruppen der Elternmitteilungen. */
export type SurveyTarget = AnnouncementTarget;

interface SurveyQuestionInput {
  kind: SurveyQuestionKind;
  prompt: string;
  required: boolean;
  options?: string[];
}

/**
 * Was der Editor sendet. `send_email`: nur bei Eltern zusätzlich eine E-Mail
 * beim Veröffentlichen. `closes_at`: Zeitpunkt (RFC 3339). `targets`: bei
 * Eltern mindestens ein Ziel, bei Mitarbeitenden leer.
 */
export type SurveyInput = Required<
  Pick<
    surveysContract.surveyRequest,
    "title" | "intro" | "anonymous" | "send_email"
  >
> & {
  audience: SurveyAudience;
  closes_at: string;
  targets: SurveyTarget[];
  questions: SurveyQuestionInput[];
};

export type Survey = Omit<
  surveysContract.surveyResponse,
  "audience" | "status" | "targets" | "questions"
> & {
  audience: SurveyAudience;
  status: SurveyStatus;
  targets: SurveyTarget[];
  questions: SurveyQuestion[];
};

/**
 * Das Ergebnis einer Frage. `scale_counts`: fünf Werte, Index 0 = Wert 1.
 * `texts`: ohne Zeit und Person, in zufälliger Reihenfolge. `highest` und
 * `lowest`: die Labels (bzw. "1" bis "5") mit den höchsten und niedrigsten
 * Werten. `withheld`: anonyme Umfrage, Frage mit weniger Antworten als die
 * Mindestzahl, also nur `answer_count`, keine Werte und keine Freitexte.
 */
export type SurveyQuestionResult = Omit<
  surveysContract.surveyQuestionResultResponse,
  "kind" | "options" | "scale_counts" | "texts" | "highest" | "lowest"
> & {
  kind: SurveyQuestionKind;
  options: surveysContract.surveyOptionCountResponse[];
  scale_counts: number[];
  texts: string[];
  highest: string[];
  lowest: string[];
};

/**
 * Die Auswertung. `available` false: noch zu wenige Antworten oder eine
 * anonyme Umfrage läuft noch; `questions` ist dann leer.
 */
export type SurveyResults = Omit<
  surveysContract.surveyResultsResponse,
  "status" | "questions" | "strengths" | "improvements"
> & {
  status: SurveyStatus;
  questions: SurveyQuestionResult[];
  strengths: surveysContract.surveyHighlightResponse[];
  improvements: surveysContract.surveyHighlightResponse[];
};

/** Nur bei nicht anonymen Umfragen. */
export type SurveyRespondent = Omit<
  surveysContract.surveyRespondentResponse,
  "answers"
> & {
  answers: (Omit<surveysContract.surveyRespondentAnswerResponse, "options"> & {
    options: string[];
  })[];
};

function toQuestion(
  question: surveysContract.surveyQuestionResponse,
): SurveyQuestion {
  // The backend writes the four question kinds of SurveyQuestionKind.
  return {
    ...question,
    kind: question.kind as SurveyQuestionKind,
    options: question.options ?? [],
  };
}

function toSurvey(survey: surveysContract.surveyResponse): Survey {
  return {
    ...survey,
    // The backend writes the values listed above.
    audience: survey.audience as SurveyAudience,
    status: survey.status as SurveyStatus,
    targets: (survey.targets ?? []) as SurveyTarget[],
    questions: (survey.questions ?? []).map(toQuestion),
  };
}

const surveyParams = (id: string) => ({ surveyId: id });

export async function fetchSurveys(): Promise<Survey[]> {
  const surveys = await bffJson("tenant", "GET /api/surveys/", {
    errorMessage: "Umfragen konnten nicht geladen werden",
  });
  return surveys.map(toSurvey);
}

export async function fetchSurvey(id: string): Promise<Survey> {
  return toSurvey(
    await bffJson("tenant", "GET /api/surveys/{surveyId}", {
      params: surveyParams(id),
      errorMessage: "Umfrage konnte nicht geladen werden",
    }),
  );
}

export async function createSurvey(input: SurveyInput): Promise<Survey> {
  return toSurvey(
    await bffJson("tenant", "POST /api/surveys/", {
      body: input,
      errorMessage: "Umfrage konnte nicht angelegt werden",
    }),
  );
}

export async function updateSurvey(
  id: string,
  input: SurveyInput,
): Promise<Survey> {
  return toSurvey(
    await bffJson("tenant", "PUT /api/surveys/{surveyId}", {
      params: surveyParams(id),
      body: input,
      errorMessage: "Umfrage konnte nicht gespeichert werden",
    }),
  );
}

export async function deleteSurvey(id: string): Promise<void> {
  await bffJson("tenant", "DELETE /api/surveys/{surveyId}", {
    params: surveyParams(id),
    errorMessage: "Umfrage konnte nicht gelöscht werden",
  });
}

export async function publishSurvey(id: string): Promise<Survey> {
  return toSurvey(
    await bffJson("tenant", "POST /api/surveys/{surveyId}/publish", {
      params: surveyParams(id),
      errorMessage: "Umfrage konnte nicht veröffentlicht werden",
    }),
  );
}

export async function closeSurvey(id: string): Promise<Survey> {
  return toSurvey(
    await bffJson("tenant", "POST /api/surveys/{surveyId}/close", {
      params: surveyParams(id),
      errorMessage: "Umfrage konnte nicht beendet werden",
    }),
  );
}

/** Erinnert alle, die noch nicht teilgenommen haben. Liefert nur die Zahl. */
export async function remindSurvey(id: string): Promise<number> {
  const result = await bffJson(
    "tenant",
    "POST /api/surveys/{surveyId}/remind",
    {
      params: surveyParams(id),
      errorMessage: "Erinnerung konnte nicht verschickt werden",
    },
  );
  return result.reminded;
}

export async function fetchSurveyResults(id: string): Promise<SurveyResults> {
  const results = await bffJson(
    "tenant",
    "GET /api/surveys/{surveyId}/results",
    {
      params: surveyParams(id),
      errorMessage: "Auswertung konnte nicht geladen werden",
    },
  );
  return {
    ...results,
    status: results.status as SurveyStatus,
    questions: (results.questions ?? []).map((question) => ({
      ...question,
      kind: question.kind as SurveyQuestionKind,
      options: question.options ?? [],
      scale_counts: question.scale_counts ?? [],
      texts: question.texts ?? [],
      highest: question.highest ?? [],
      lowest: question.lowest ?? [],
    })),
    strengths: results.strengths ?? [],
    improvements: results.improvements ?? [],
  };
}

export async function fetchSurveyRespondents(
  id: string,
): Promise<SurveyRespondent[]> {
  const respondents = await bffJson(
    "tenant",
    "GET /api/surveys/{surveyId}/respondents",
    {
      params: surveyParams(id),
      errorMessage: "Antworten konnten nicht geladen werden",
    },
  );
  return respondents.map((respondent) => ({
    ...respondent,
    answers: (respondent.answers ?? []).map((answer) => ({
      ...answer,
      options: answer.options ?? [],
    })),
  }));
}

/**
 * Lädt die Auswertung als PDF unter dem Dateinamen des Backends. Erst
 * holen, dann speichern: ein Fehler bleibt als Meldung auf der Seite.
 */
export async function downloadSurveyResultsPdf(id: string): Promise<void> {
  const response = await bffFile(
    "tenant",
    "GET /api/surveys/{surveyId}/results/export",
    {
      params: surveyParams(id),
      errorMessage: "Die Datei konnte nicht erstellt werden",
    },
  );
  const blob = await response.blob();
  downloadBlob(
    blob,
    filenameFromDisposition(response) ?? `umfrage-${id}-auswertung.pdf`,
  );
}

/* --- Beantworten (jede Person mit Mitarbeiter-Datensatz) ----------------- */

export function fetchSurveysToAnswer(): Promise<
  surveysContract.surveyToAnswerResponse[]
> {
  return bffJson("tenant", "GET /api/surveys/to-answer", {
    errorMessage: "Umfragen konnten nicht geladen werden",
  });
}

export async function fetchSurveyForm(id: string): Promise<SurveyForm> {
  const form = await bffJson("tenant", "GET /api/surveys/{surveyId}/form", {
    params: surveyParams(id),
    errorMessage: "Umfrage konnte nicht geladen werden",
  });
  return {
    ...form,
    survey: {
      ...form.survey,
      questions: (form.survey.questions ?? []).map(toQuestion),
    },
  };
}

export async function submitSurveyAnswers(
  id: string,
  body: SurveyAnswersRequest,
): Promise<void> {
  await bffJson("tenant", "POST /api/surveys/{surveyId}/answers", {
    params: surveyParams(id),
    body,
    errorMessage: "Antwort konnte nicht gespeichert werden",
  });
}
