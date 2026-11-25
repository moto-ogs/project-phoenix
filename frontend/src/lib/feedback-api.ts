import type { FeedbackResponse } from "~/lib/contract/feedback.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { ApiError } from "./api-error";
import { bffJson } from "./bff-fetch";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "FeedbackAPI" });

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  feedbackType: "positive" | "neutral" | "negative";
  isMensaFeedback: boolean;
}

const FEEDBACK_VALUES: readonly FeedbackEntry["feedbackType"][] = [
  "positive",
  "neutral",
  "negative",
];

export function mapFeedbackResponse(entry: FeedbackResponse): FeedbackEntry {
  // Combine day + time into a timestamp
  // day is "2026-04-06", time is "15:30:23"
  const timestamp = `${entry.day}T${entry.time}`;

  return {
    id: entry.id,
    timestamp,
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
