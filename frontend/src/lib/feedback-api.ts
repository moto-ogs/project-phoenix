import type { FeedbackResponse } from "~/lib/contract/feedback.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "FeedbackAPI" });

export interface FeedbackEntry {
  id: string;
  /** Berliner Schultag, "YYYY-MM-DD". */
  day: string;
  /** Wanduhrzeit der Schule, "HH:MM:SS"; kein Zeitpunkt (#8270). */
  time: string;
  feedbackType: "positive" | "neutral" | "negative";
  isMensaFeedback: boolean;
}

const FEEDBACK_VALUES: readonly FeedbackEntry["feedbackType"][] = [
  "positive",
  "neutral",
  "negative",
];

export function mapFeedbackResponse(entry: FeedbackResponse): FeedbackEntry {
  // Go liefert Schultag und Wanduhrzeit getrennt. Zusammengesetzt ohne
  // Offset würde der Browser sie in seiner Zeitzone lesen (#8270).
  return {
    id: entry.id,
    day: entry.day,
    time: entry.time,
    feedbackType: knownEnum(FEEDBACK_VALUES, entry.value) ?? "neutral",
    isMensaFeedback: entry.is_mensa_feedback,
  };
}

export async function fetchStudentFeedback(
  studentId: string,
): Promise<FeedbackEntry[]> {
  try {
    const entries = await bffJson("tenant", "GET /api/feedback/student/{id}", {
      params: { id: studentId },
    });
    return entries.map(mapFeedbackResponse);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return [];
    logger.error("fetch_student_feedback_failed", {
      error: error instanceof Error ? error.message : String(error),
      student_id: studentId,
    });
    throw error;
  }
}
