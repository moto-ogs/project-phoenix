import { bffJson } from "~/lib/bff-fetch";
import type * as studentsContract from "~/lib/contract/students.generated";

export function getRequestFeedStatus(): Promise<studentsContract.FeedStatus> {
  return bffJson("tenant", "GET /api/students/change-requests/rss-feed/", {
    errorMessage: "request feed failed",
  });
}

export function createRequestFeed(): Promise<studentsContract.FeedLink> {
  return bffJson("tenant", "POST /api/students/change-requests/rss-feed/", {
    errorMessage: "request feed failed",
  });
}

export function rotateRequestFeed(): Promise<studentsContract.FeedLink> {
  return bffJson(
    "tenant",
    "POST /api/students/change-requests/rss-feed/rotate",
    {
      errorMessage: "request feed failed",
    },
  );
}
