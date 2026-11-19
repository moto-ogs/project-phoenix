/**
 * Temporary (#2352): the data of an answer that a route sends bare today and
 * in the envelope once its route file leaves for the portal's catalog proxy
 * (`{ success, message, data }`, or the backend's `{ status, data }` that a
 * route passes on). The current client reads both shapes for one release;
 * read `data` directly once the temporary route files are gone.
 */
export function dataOrBare<T>(answer: unknown): T {
  if (
    typeof answer === "object" &&
    answer !== null &&
    !Array.isArray(answer) &&
    "data" in answer &&
    ("success" in answer || "status" in answer)
  ) {
    return (answer as { data: T }).data;
  }
  return answer as T;
}
