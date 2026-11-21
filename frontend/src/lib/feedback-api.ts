import type { FeedbackResponse } from "~/lib/contract/feedback.generated";
import { knownEnum } from "~/lib/contract/known-enum";
import { apiErrorFromResponse } from "./api-error";
import { sessionFetch } from "./session-cache";
import { createLogger } from "~/lib/logger";

const logger = createLogger({ component: "FeedbackAPI" });

export interface FeedbackEntry {
  id: string;
  timestamp: string;
  feedback_type: "positive" | "neutral" | "negative";
  is_mensa_feedback: boolean;
}

const FEEDBACK_VALUES: readonly FeedbackEntry["feedback_type"][] = [
  "positive",
  "neutral",
  "negative",
];

function mapFeedbackResponse(entry: FeedbackResponse): FeedbackEntry {
  // Combine day + time into a timestamp
  // day is "2026-04-06", time is "15:30:23"
  const timestamp = `${entry.day}T${entry.time}`;

  return {
    id: entry.id,
    timestamp,
    feedback_type: knownEnum(FEEDBACK_VALUES, entry.value) ?? "neutral",
    is_mensa_feedback: entry.is_mensa_feedback,
  };
}

export async function fetchStudentFeedback(
  studentId: string,
): Promise<FeedbackEntry[]> {
  const url = `/api/feedback/student/${studentId}`;

  try {
    const response = await sessionFetch(url, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      if (response.status === 404) return [];
      // The message is diagnosis only; callers read status and code.
      throw await apiErrorFromResponse(
        response,
        `Failed to fetch feedback: ${response.status} ${response.statusText}`,
      );
    }

    const responseData = (await response.json()) as {
      data: FeedbackResponse[];
    };
    const entries = responseData.data ?? [];
    return entries.map(mapFeedbackResponse);
  } catch (error) {
    logger.error("fetch_student_feedback_failed", {
      error: error instanceof Error ? error.message : String(error),
      student_id: studentId,
    });
    throw error;
  }
}
