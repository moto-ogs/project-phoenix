// Temporary (#7563): the current client calls the backend's own path
// /api/enrollment/admin/requests/{id}/children/{childId}/decide through the
// portal's catalog proxy. An installed bundle of the previous release still
// calls this flattened path with request_id and child_id in the body; this file
// moves them into the path. Delete it after the next production deploy.
import { enrollmentChildPath } from "~/lib/enrollment-admin-child.server";
import { tenant } from "~/lib/route-wrapper.server";
import { parseRequestBody } from "~/lib/route-wrapper-utils.server";

interface DecideBody {
  request_id?: string | number;
  child_id?: string | number;
  status?: string;
  reason?: string;
  existing_student_id?: string | number;
  create_new_student?: boolean;
  shown_existing_student_ids?: unknown;
  accept_offering_changes?: boolean;
}

/** The candidates the office saw before it chose a new child (#6247). */
function shownStudentIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((id): id is string | number =>
          ["string", "number"].includes(typeof id),
        )
        .map(String)
    : [];
}

export const POST = tenant.route(async (request) => {
  const body = await parseRequestBody<DecideBody>(request);
  return tenant.forwardToBackend(request, enrollmentChildPath(body, "decide"), {
    method: "POST",
    json: {
      status: body.status,
      reason: body.reason ?? "",
      // The office's answer for a child that may already be enrolled (#6053).
      ...(body.existing_student_id != null
        ? { existing_student_id: String(body.existing_student_id) }
        : {}),
      ...(body.create_new_student === true
        ? {
            create_new_student: true,
            shown_existing_student_ids: shownStudentIds(
              body.shown_existing_student_ids,
            ),
          }
        : {}),
      // The office confirmed offering changes since the submission (#6837).
      ...(body.accept_offering_changes === true
        ? { accept_offering_changes: true }
        : {}),
    },
  });
});
